-- create_order deja de confiar en lo que manda el navegador:
--  * vendedor: siempre el nombre del perfil de auth.uid() (se ignora p.seller);
--  * estado: se deriva de los pagos; la única excepción es 'entregado' en mostrador ('tienda') ya pagado (POS);
--  * precio: quien no es dueño no vende debajo del precio de catálogo (o del nivel de mayoreo guardado en settings);
--  * NaN e infinitos se rechazan (en Postgres NaN es mayor que todo y se saltaría el mínimo).
-- La regla del descuento no cambia. Es la definición de 20261020000200_decisiones.sql con esos cambios;
-- create or replace conserva los permisos EXECUTE vigentes.
-- p: { channel, customerId, customerName, branch, items[], discount, shipping, payments[], status?,
--      shippingInfo, notes, pickup, quoteId, tierId, seller }  (status y seller solo se leen como se explica arriba)
create or replace function public.create_order(p jsonb) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v public.orders;
  v_business uuid := public.current_business_id();
  v_owner boolean := public.is_owner();
  it jsonb;
  cur int;
  br text := p ->> 'branch';
  v_customer text := nullif(p ->> 'customerId', '');
  v_subtotal numeric := 0;
  v_discount numeric := coalesce((p ->> 'discount')::numeric, 0);
  v_shipping numeric := coalesce((p ->> 'shipping')::numeric, 0);
  v_total numeric;
  v_payments jsonb;
  v_paid numeric;
  v_folio text;
  v_my_branch text;
  v_items jsonb;
  v_costs jsonb := '{}'::jsonb;
  v_seller text;
  v_status text;
  v_tier jsonb;
  v_price numeric;
  v_catalog numeric;
  v_min numeric;
  v_disc numeric;
begin
  perform public.assert_member();
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'El pedido no tiene productos'; end if;
  if not exists (select 1 from public.branches where id = br and business_id = v_business) then raise exception 'Sucursal inválida'; end if;
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and business_id = v_business) then
    raise exception 'Cliente inválido';
  end if;

  -- abs(x) >= 'Infinity' es verdadero para NaN e infinitos (NaN es mayor que todo en numeric)
  if abs(v_discount) >= 'Infinity'::numeric then raise exception 'Descuento inválido'; end if;
  if abs(v_shipping) >= 'Infinity'::numeric then raise exception 'Envío inválido'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) x
              where abs((x ->> 'amount')::numeric) >= 'Infinity'::numeric) then
    raise exception 'Monto de pago inválido';
  end if;

  -- Los vendedores solo pueden vender en mostrador de su sucursal asignada
  if p ->> 'channel' = 'tienda' and not v_owner then
    select branch into v_my_branch from public.profiles where id = auth.uid();
    if br is distinct from v_my_branch then
      raise exception 'Solo puedes vender en tu sucursal asignada';
    end if;
  end if;

  -- El nivel de mayoreo se lee de la configuración del negocio, nunca del payload
  if not v_owner and nullif(p ->> 'tierId', '') is not null then
    select t into v_tier
      from public.settings s, jsonb_array_elements(coalesce(s.value -> 'tiers', '[]'::jsonb)) t
     where s.business_id = v_business and s.key = 'wholesale' and t ->> 'id' = p ->> 'tierId';
    if v_tier is null then raise exception 'Nivel de mayoreo inválido'; end if;
    v_disc := coalesce((v_tier ->> 'discount')::numeric, 0);
  end if;

  select coalesce(jsonb_agg(x - 'unitCost' order by n), '[]'::jsonb) into v_items
    from jsonb_array_elements(p -> 'items') with ordinality t(x, n);

  -- Orden fijo de bloqueo para evitar interbloqueos entre ventas simultáneas
  for it in select value from jsonb_array_elements(p -> 'items') order by value ->> 'variantKey' loop
    if (it ->> 'qty')::int <= 0 then raise exception 'Cantidad inválida'; end if;
    v_price := coalesce((it ->> 'unitPrice')::numeric, -1);
    if v_price < 0 or abs(v_price) >= 'Infinity'::numeric then raise exception 'Precio inválido'; end if;
    if not v_owner then
      select pr.price into v_catalog
        from public.stock s join public.products pr on pr.id = s.product_id
       where s.variant_key = it ->> 'variantKey' and s.business_id = v_business
       limit 1;
      -- Mismo cálculo que tierPrice en src/lib/wholesale.ts. Si la variante no existe v_min es null y falla abajo por existencia.
      v_min := case when v_disc > 0 then round(v_catalog * (1 - v_disc) / 5) * 5 else v_catalog end;
      if v_price < v_min then raise exception 'Precio menor al de catálogo: solo el dueño puede cambiarlo'; end if;
    end if;
    select qty into cur from public.stock
     where variant_key = it ->> 'variantKey' and branch = br and business_id = v_business for update;
    if coalesce(cur, 0) < (it ->> 'qty')::int then
      raise exception 'Sin existencia suficiente: % % talla % (hay %)', it ->> 'name', it ->> 'color', it ->> 'size', coalesce(cur, 0);
    end if;
    update public.stock set qty = qty - (it ->> 'qty')::int
     where variant_key = it ->> 'variantKey' and branch = br and business_id = v_business;
    v_subtotal := v_subtotal + (it ->> 'qty')::int * v_price;
    v_costs := v_costs || jsonb_build_object(it ->> 'variantKey', coalesce(
      (select pc.cost from public.stock s join public.product_costs pc on pc.product_id = s.product_id
        where s.variant_key = it ->> 'variantKey' and s.branch = br and s.business_id = v_business), 0));
  end loop;

  if v_discount < 0 or v_discount > v_subtotal then raise exception 'Descuento inválido'; end if;
  if v_shipping < 0 then raise exception 'Envío inválido'; end if;
  v_total := v_subtotal - v_discount + v_shipping;
  select coalesce(jsonb_agg(x || jsonb_build_object('id', gen_random_uuid()::text, 'date', now())), '[]'::jsonb)
    into v_payments
  from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) x
  where (x ->> 'amount')::numeric > 0;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_paid from jsonb_array_elements(v_payments) x;
  if v_paid > v_total then raise exception 'Los pagos exceden el total del pedido'; end if;

  select name into v_seller from public.profiles where id = auth.uid();
  v_status := case
    when v_paid >= v_total and p ->> 'channel' = 'tienda' and p ->> 'status' = 'entregado' then 'entregado'
    when v_paid >= v_total then 'pagado'
    when v_paid > 0 then 'apartado'
    else 'pendiente'
  end;

  -- Folio consecutivo del negocio
  update public.businesses set next_order_folio = next_order_folio + 1
   where id = v_business
  returning order_prefix || (next_order_folio - 1)::text into v_folio;

  insert into public.orders (business_id, folio, channel, customer_id, customer_name, branch, items, subtotal, discount, shipping, total,
                             payments, status, shipping_info, notes, pickup, quote_id, tier_id, seller)
  values (
    v_business, v_folio, p ->> 'channel', v_customer, p ->> 'customerName', br, v_items,
    v_subtotal, v_discount, v_shipping, v_total, v_payments,
    v_status,
    p -> 'shippingInfo', p ->> 'notes', coalesce((p ->> 'pickup')::boolean, false), p ->> 'quoteId', p ->> 'tierId', v_seller
  )
  returning * into v;

  insert into public.order_costs (order_id, business_id, costs) values (v.id, v_business, v_costs);

  insert into public.movements (business_id, type, product_id, variant_key, branch, qty, ref)
  select v_business, 'venta', s.product_id, s.variant_key, br, -(x ->> 'qty')::int, v_folio
  from jsonb_array_elements(p -> 'items') x
  join public.stock s on s.variant_key = x ->> 'variantKey' and s.branch = br and s.business_id = v_business;

  return v;
end;
$$;
