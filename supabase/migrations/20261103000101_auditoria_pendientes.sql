-- Auditoría · pendientes (2/2). IDs de .audit/01-base-de-datos.md (DB-xx) y .audit/02-aplicacion-next.md (APP-xx).
-- Requiere 20261103000100_rol_encargado.sql. Cada función parte de su definición vigente (citada) y cambia solo lo indicado.

-- ---------------------------------------------------------------------------
-- Rol encargado (boutique) · DB-03
-- ---------------------------------------------------------------------------
-- Versión de 20261102000101_multinegocio.sql con el encargado.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role() in ('dueno', 'vendedor', 'encargado'), false)
$$;

-- Interna: solo la llaman funciones security definer.
create function public.can_move_stock() returns boolean
language sql stable set search_path = public as $$
  select coalesce(public.member_role() in ('dueno', 'encargado'), false)
$$;
revoke execute on function public.can_move_stock() from public, anon, authenticated;

-- Versión de 20261102000101_multinegocio.sql: en boutique también se asigna "encargado".
create or replace function public.set_member(p_id uuid, p_role public.app_role, p_branch text) returns public.business_members
language plpgsql security definer set search_path = public as $$
declare v public.business_members; v_business uuid := public.current_business_id(); v_kind text;
begin
  perform public.assert_member();
  if not public.is_owner() then raise exception 'Solo el dueño puede administrar el equipo'; end if;
  if p_id = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  if p_role = 'dueno' then raise exception 'Solo puede haber un dueño'; end if;
  select kind into v_kind from public.businesses where id = v_business;
  if p_role <> 'pendiente' and p_role::text <> all (case v_kind when 'restaurante' then array['mesero', 'cajero', 'cocina'] else array['vendedor', 'encargado'] end) then
    raise exception 'Ese puesto no existe en este giro';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and business_id = v_business) then
    raise exception 'Sucursal inválida';
  end if;
  update public.business_members set role = p_role, branch = p_branch
   where user_id = p_id and business_id = v_business returning * into v;
  if v.user_id is null then raise exception 'Colaborador no encontrado'; end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventario solo dueño o encargado (cualquier sucursal del negocio) · DB-03
-- Versiones de 20261019000300_operaciones.sql.
-- ---------------------------------------------------------------------------
create or replace function public.move_stock(p_entries jsonb, p_branch text, p_type text, p_ref text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb; cur int; v_product text; v_business uuid := public.current_business_id();
begin
  perform public.assert_member();
  if not public.can_move_stock() then raise exception 'Solo el dueño o el encargado mueven inventario'; end if;
  if p_type not in ('entrada', 'ajuste') then raise exception 'Tipo de movimiento inválido'; end if;
  if not exists (select 1 from public.branches where id = p_branch and business_id = v_business) then raise exception 'Sucursal inválida'; end if;
  for e in select value from jsonb_array_elements(p_entries) order by value ->> 'variantKey' loop
    continue when coalesce((e ->> 'qty')::int, 0) = 0;
    select product_id, qty into v_product, cur from public.stock
     where variant_key = e ->> 'variantKey' and branch = p_branch and business_id = v_business for update;
    if cur is null then raise exception 'Variante inexistente: %', e ->> 'variantKey'; end if;
    update public.stock set qty = greatest(0, qty + (e ->> 'qty')::int)
     where variant_key = e ->> 'variantKey' and branch = p_branch and business_id = v_business;
    insert into public.movements (business_id, type, product_id, variant_key, branch, qty, ref, note)
    values (v_business, p_type, v_product, e ->> 'variantKey', p_branch,
            greatest(-cur, (e ->> 'qty')::int), p_ref, p_note);
  end loop;
end;
$$;

create or replace function public.transfer_stock(p_entries jsonb, p_from text, p_to text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e jsonb; cur int; v_product text;
  v_business uuid := public.current_business_id();
  v_ref text := 'TR-' || to_char(now(), 'YYMMDDHH24MISS');
  v_from_name text;
  v_to_name text;
begin
  perform public.assert_member();
  if not public.can_move_stock() then raise exception 'Solo el dueño o el encargado mueven inventario'; end if;
  if p_from = p_to then raise exception 'Elige ubicaciones distintas'; end if;
  select name into v_from_name from public.branches where id = p_from and business_id = v_business;
  select name into v_to_name from public.branches where id = p_to and business_id = v_business;
  if v_from_name is null or v_to_name is null then raise exception 'Sucursal inválida'; end if;
  for e in select value from jsonb_array_elements(p_entries) order by value ->> 'variantKey' loop
    continue when coalesce((e ->> 'qty')::int, 0) <= 0;
    -- Bloquea origen y destino en el mismo orden para que dos traspasos opuestos no se interbloqueen
    perform 1 from public.stock
     where variant_key = e ->> 'variantKey' and branch in (p_from, p_to) and business_id = v_business
     order by branch for update;
    select product_id, qty into v_product, cur from public.stock
     where variant_key = e ->> 'variantKey' and branch = p_from and business_id = v_business;
    if coalesce(cur, 0) < (e ->> 'qty')::int then raise exception 'Sin existencia suficiente para traspasar %', e ->> 'variantKey'; end if;
    update public.stock set qty = qty + (e ->> 'qty')::int
     where variant_key = e ->> 'variantKey' and branch = p_to and business_id = v_business;
    if not found then raise exception 'Variante inexistente en el destino: %', e ->> 'variantKey'; end if;
    update public.stock set qty = qty - (e ->> 'qty')::int
     where variant_key = e ->> 'variantKey' and branch = p_from and business_id = v_business;
    insert into public.movements (business_id, type, product_id, variant_key, branch, qty, ref, note) values
      (v_business, 'traspaso', v_product, e ->> 'variantKey', p_from, -(e ->> 'qty')::int, v_ref, 'Hacia ' || v_to_name),
      (v_business, 'traspaso', v_product, e ->> 'variantKey', p_to, (e ->> 'qty')::int, v_ref, 'Desde ' || v_from_name);
  end loop;
end;
$$;

create or replace function public.set_stock_count(p_branch text, p_entries jsonb, p_note text default 'Conteo físico')
returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; cur int; v_product text; changed int := 0; v_business uuid := public.current_business_id();
begin
  perform public.assert_member();
  if not public.can_move_stock() then raise exception 'Solo el dueño o el encargado mueven inventario'; end if;
  if not exists (select 1 from public.branches where id = p_branch and business_id = v_business) then raise exception 'Sucursal inválida'; end if;
  for e in select value from jsonb_array_elements(p_entries) order by value ->> 'variantKey' loop
    if (e ->> 'qty')::int < 0 then raise exception 'La existencia no puede ser negativa'; end if;
    select product_id, qty into v_product, cur from public.stock
     where variant_key = e ->> 'variantKey' and branch = p_branch and business_id = v_business for update;
    if cur is null then raise exception 'Variante inexistente: %', e ->> 'variantKey'; end if;
    continue when cur = (e ->> 'qty')::int;
    update public.stock set qty = (e ->> 'qty')::int
     where variant_key = e ->> 'variantKey' and branch = p_branch and business_id = v_business;
    insert into public.movements (business_id, type, product_id, variant_key, branch, qty, note)
    values (v_business, 'ajuste', v_product, e ->> 'variantKey', p_branch, (e ->> 'qty')::int - cur, p_note);
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar pedidos solo dueño o encargado (APP-11); la devolución suma por variante y bloquea en orden fijo (DB-08)
-- Versión de 20261020000200_decisiones.sql.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status(p_order text, p_status text, p_shipping jsonb default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders; prev text; v_pickup boolean; v_business uuid := public.current_business_id(); r record; v_product text;
begin
  perform public.assert_member();
  if p_status = 'cancelado' and not public.can_move_stock() then raise exception 'Solo el dueño o el encargado cancelan pedidos'; end if;
  select status, pickup into prev, v_pickup from public.orders where id = p_order and business_id = v_business for update;
  if prev is null then raise exception 'Pedido no encontrado'; end if;
  if prev = 'cancelado' then raise exception 'El pedido ya está cancelado'; end if;
  if not (case p_status
            when 'cancelado' then prev <> 'entregado'
            when 'enviado' then prev = 'pagado' and not v_pickup
            when 'entregado' then prev = 'enviado' or (prev = 'pagado' and v_pickup)
            else false
          end) then
    raise exception 'No se puede cambiar el pedido de % a %', prev, p_status;
  end if;

  update public.orders
     set status = p_status,
         shipping_info = case when p_shipping is null then shipping_info else coalesce(shipping_info, '{}'::jsonb) || p_shipping end
   where id = p_order and business_id = v_business
  returning * into v;

  if p_status = 'cancelado' then
    for r in select x ->> 'variantKey' as vk, sum((x ->> 'qty')::int) as qty
               from jsonb_array_elements(v.items) x group by 1 order by 1 loop
      update public.stock set qty = qty + r.qty
       where variant_key = r.vk and branch = v.branch and business_id = v_business
      returning product_id into v_product;
      continue when not found;
      insert into public.movements (business_id, type, product_id, variant_key, branch, qty, ref, note)
      values (v_business, 'cancelacion', v_product, r.vk, v.branch, r.qty, v.folio, 'Regreso a inventario por cancelación');
    end loop;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_payment guarda solo method, amount y note del cliente · APP-11
-- Versión de 20261020000100_correcciones.sql.
-- ---------------------------------------------------------------------------
create or replace function public.add_payment(p_order text, p_payment jsonb) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders; v_paid numeric; v_due numeric; v_business uuid := public.current_business_id();
begin
  perform public.assert_member();
  if coalesce((p_payment ->> 'amount')::numeric, 0) <= 0 then raise exception 'Monto inválido'; end if;
  select total - coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(payments) x), 0)
    into v_due from public.orders where id = p_order and business_id = v_business and status <> 'cancelado' for update;
  if v_due is null then raise exception 'Pedido no encontrado o cancelado'; end if;
  if (p_payment ->> 'amount')::numeric > v_due then raise exception 'El pago excede el saldo pendiente'; end if;
  update public.orders
     set payments = payments || jsonb_build_array(
           jsonb_strip_nulls(jsonb_build_object('method', p_payment -> 'method', 'amount', p_payment -> 'amount', 'note', p_payment -> 'note'))
           || jsonb_build_object('id', gen_random_uuid()::text, 'date', now()))
   where id = p_order and business_id = v_business and status <> 'cancelado'
  returning * into v;
  if v.id is null then raise exception 'Pedido no encontrado o cancelado'; end if;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_paid from jsonb_array_elements(v.payments) x;
  if v_paid >= v.total and v.status in ('pendiente', 'apartado') then
    update public.orders set status = 'pagado' where id = p_order returning * into v;
  elsif v_paid > 0 and v.status = 'pendiente' then
    update public.orders set status = 'apartado' where id = p_order returning * into v;
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Renglones de pedidos y cotizaciones · DB-04, DB-08, DB-10
-- ---------------------------------------------------------------------------
-- Interna, compartida por create_order y save_quote. Para todos: 1..200 renglones, sin variantKey repetido, qty entera > 0
-- y unitPrice finito >= 0. Para quien no es dueño, además: el nivel sale de settings (nunca del payload), sus piezas mínimas
-- se cumplen salvo la regla de distribuidor (tierFor/distributorRule en src/lib/wholesale.ts) y el precio no baja del piso
-- del nivel (tierPrice).
create function public.check_sale_items(p_business uuid, p_items jsonb, p_tier_id text, p_customer text) returns void
language plpgsql stable set search_path = public as $$
declare
  it jsonb; v_qty numeric; v_price numeric; v_pieces numeric := 0;
  v_tier jsonb; v_dist numeric; v_disc numeric := 0; v_catalog numeric; v_min numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El pedido no tiene productos'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'El pedido admite hasta 200 renglones'; end if;
  if (select count(distinct x ->> 'variantKey') from jsonb_array_elements(p_items) x) < jsonb_array_length(p_items) then
    raise exception 'Producto repetido en el pedido';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_qty := (it ->> 'qty')::numeric;
    v_price := (it ->> 'unitPrice')::numeric;
    -- NaN es mayor que todo en numeric: los rangos cerrados descartan NaN e infinitos
    if v_qty is null or v_qty not between 1 and 2147483647 or v_qty <> trunc(v_qty) then raise exception 'Cantidad inválida'; end if;
    if v_price is null or not (v_price >= 0 and v_price < 'Infinity') then raise exception 'Precio inválido'; end if;
    v_pieces := v_pieces + v_qty;
  end loop;

  if public.is_owner() then return; end if;

  if nullif(p_tier_id, '') is not null then
    select t, coalesce((s.value ->> 'distributorCustomerMin')::numeric, 0) into v_tier, v_dist
      from public.settings s, jsonb_array_elements(coalesce(s.value -> 'tiers', '[]'::jsonb)) t
     where s.business_id = p_business and s.key = 'wholesale' and t ->> 'id' = p_tier_id;
    if v_tier is null then raise exception 'Nivel de mayoreo inválido'; end if;
    if v_pieces < coalesce((v_tier ->> 'minPieces')::numeric, 0)
       and not (v_dist > 0 and v_pieces >= v_dist and exists (
         select 1 from public.customers where id = p_customer and business_id = p_business and type = 'distribuidor')) then
      raise exception 'El pedido no alcanza las piezas mínimas de ese nivel de mayoreo';
    end if;
    v_disc := coalesce((v_tier ->> 'discount')::numeric, 0);
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    select pr.price into v_catalog
      from public.stock s join public.products pr on pr.id = s.product_id
     where s.variant_key = it ->> 'variantKey' and s.business_id = p_business
     limit 1;
    if v_catalog is null then raise exception 'Producto no encontrado: %', it ->> 'variantKey'; end if;
    -- Mismo cálculo que tierPrice en src/lib/wholesale.ts
    v_min := case when v_disc > 0 then round(v_catalog * (1 - v_disc) / 5) * 5 else v_catalog end;
    if (it ->> 'unitPrice')::numeric < v_min then raise exception 'Precio menor al de catálogo: solo el dueño puede cambiarlo'; end if;
  end loop;
end;
$$;
revoke execute on function public.check_sale_items(uuid, jsonb, text, text) from public, anon, authenticated;

-- Versión de 20261102000101_multinegocio.sql: los renglones, el nivel y el piso de precio pasan a check_sale_items.
CREATE OR REPLACE FUNCTION public.create_order(p jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
begin
  perform public.assert_member();
  perform public.check_sale_items(v_business, p -> 'items', p ->> 'tierId', v_customer);
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
    select branch into v_my_branch from public.business_members where user_id = auth.uid() and business_id = v_business;
    if br is distinct from v_my_branch then
      raise exception 'Solo puedes vender en tu sucursal asignada';
    end if;
  end if;

  select coalesce(jsonb_agg(x - 'unitCost' order by n), '[]'::jsonb) into v_items
    from jsonb_array_elements(p -> 'items') with ordinality t(x, n);

  -- Orden fijo de bloqueo para evitar interbloqueos entre ventas simultáneas
  for it in select value from jsonb_array_elements(p -> 'items') order by value ->> 'variantKey' loop
    select qty into cur from public.stock
     where variant_key = it ->> 'variantKey' and branch = br and business_id = v_business for update;
    if coalesce(cur, 0) < (it ->> 'qty')::int then
      raise exception 'Sin existencia suficiente: % % talla % (hay %)', it ->> 'name', it ->> 'color', it ->> 'size', coalesce(cur, 0);
    end if;
    update public.stock set qty = qty - (it ->> 'qty')::int
     where variant_key = it ->> 'variantKey' and branch = br and business_id = v_business;
    v_subtotal := v_subtotal + (it ->> 'qty')::int * (it ->> 'unitPrice')::numeric;
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
$function$;

-- ---------------------------------------------------------------------------
-- Cotizaciones · DB-02, DB-04, APP-03
-- ---------------------------------------------------------------------------
drop policy "equipo actualiza cotizaciones" on public.quotes;
revoke update on public.quotes from authenticated;

-- El único cambio de estado desde la app. "convertida" solo la pone convert_quote.
create function public.set_quote_status(p_id text, p_status text) returns public.quotes
language plpgsql security definer set search_path = public as $$
declare v public.quotes; v_business uuid := public.current_business_id();
begin
  perform public.assert_member();
  select * into v from public.quotes where id = p_id and business_id = v_business for update;
  if v.id is null then raise exception 'Cotización no encontrada'; end if;
  if v.status = 'convertida' or p_status = 'convertida' then raise exception 'La cotización ya es un pedido'; end if;
  if p_status is null or p_status not in ('borrador', 'enviada', 'aceptada', 'rechazada') then raise exception 'Estado de cotización inválido'; end if;
  update public.quotes set status = p_status where id = p_id and business_id = v_business returning * into v;
  return v;
end;
$$;
revoke execute on function public.set_quote_status(text, text) from public, anon, authenticated;
grant execute on function public.set_quote_status(text, text) to authenticated;

-- Versión de 20261025000100_plan_unico.sql: valida todo número y recalcula los importes en el servidor.
create or replace function public.save_quote(p jsonb) returns public.quotes
language plpgsql security definer set search_path = public as $$
declare
  v public.quotes; v_business uuid := public.current_business_id(); v_folio text; v_items jsonb;
  v_shipping numeric := (p ->> 'shipping')::numeric;
  v_deposit numeric := (p ->> 'depositPct')::numeric;
  v_list numeric; v_subtotal numeric;
begin
  perform public.assert_member();
  if not exists (select 1 from public.customers where id = p ->> 'customerId' and business_id = v_business) then
    raise exception 'Cliente inválido';
  end if;
  perform public.check_sale_items(v_business, p -> 'items', p ->> 'tierId', p ->> 'customerId');
  if exists (select 1 from jsonb_array_elements(p -> 'items') x
              where not coalesce((x ->> 'listPrice')::numeric >= 0 and (x ->> 'listPrice')::numeric < 'Infinity', false)) then
    raise exception 'Precio de lista inválido';
  end if;
  if v_shipping is null or not (v_shipping >= 0 and v_shipping < 'Infinity') then raise exception 'Envío inválido'; end if;
  if v_deposit is null or v_deposit not between 0 and 1 then raise exception 'Anticipo inválido'; end if;
  -- La app solo guarda borradores o cotizaciones enviadas (src/app/mayoreo/nueva/page.tsx); el resto va por set_quote_status.
  if p ->> 'status' is null or p ->> 'status' not in ('borrador', 'enviada') then raise exception 'Estado de cotización inválido'; end if;
  -- Mismas fórmulas que mayoreo/nueva: subtotal = Σ qty·unitPrice, descuento = lista − subtotal, total = subtotal + envío.
  select sum((x ->> 'qty')::numeric * (x ->> 'listPrice')::numeric), sum((x ->> 'qty')::numeric * (x ->> 'unitPrice')::numeric)
    into v_list, v_subtotal
    from jsonb_array_elements(p -> 'items') x;
  select coalesce(jsonb_agg(x - 'unitCost' order by n), '[]'::jsonb) into v_items
    from jsonb_array_elements(p -> 'items') with ordinality t(x, n);
  if nullif(p ->> 'id', '') is not null then
    update public.quotes set
      valid_until = (p ->> 'validUntil')::timestamptz, customer_id = p ->> 'customerId', customer_name = p ->> 'customerName',
      items = v_items, tier_id = p ->> 'tierId', subtotal_list = v_list,
      discount = v_list - v_subtotal, subtotal = v_subtotal, shipping = v_shipping,
      total = v_subtotal + v_shipping, deposit_pct = v_deposit, status = p ->> 'status', notes = p ->> 'notes'
    where id = p ->> 'id' and business_id = v_business and status <> 'convertida'
    returning * into v;
    if v.id is not null then return v; end if;
    if exists (select 1 from public.quotes where id = p ->> 'id' and business_id = v_business and status = 'convertida') then
      raise exception 'La cotización ya es un pedido';
    end if;
  end if;

  update public.businesses set next_quote_folio = next_quote_folio + 1
   where id = v_business
  returning quote_prefix || lpad((next_quote_folio - 1)::text, 4, '0') into v_folio;

  insert into public.quotes (business_id, folio, valid_until, customer_id, customer_name, items, tier_id, subtotal_list, discount, subtotal,
                             shipping, total, deposit_pct, status, notes)
  values (v_business, v_folio, (p ->> 'validUntil')::timestamptz, p ->> 'customerId',
          p ->> 'customerName', v_items, p ->> 'tierId', v_list, v_list - v_subtotal,
          v_subtotal, v_shipping, v_subtotal + v_shipping, v_deposit,
          p ->> 'status', p ->> 'notes')
  returning * into v;
  return v;
end;
$$;

alter table public.orders add constraint orders_total_valido check (total >= 0 and total <> 'NaN');
alter table public.quotes add constraint quotes_total_valido check (total >= 0 and total <> 'NaN'),
                          add constraint quotes_deposit_pct_valido check (deposit_pct between 0 and 1);

-- ---------------------------------------------------------------------------
-- Bitácora de los datos de cobro de la plataforma · DB-06 (la app sigue con su UPDATE directo)
-- ---------------------------------------------------------------------------
create table public.platform_settings_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  old jsonb,
  new jsonb
);
alter table public.platform_settings_log enable row level security;
revoke all on public.platform_settings_log from anon, authenticated;

create function public.log_platform_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.platform_settings_log (actor, old, new) values (auth.uid(), to_jsonb(old), to_jsonb(new));
  return null;
end;
$$;
revoke execute on function public.log_platform_settings() from public, anon, authenticated;

create trigger platform_settings_log after update on public.platform_settings
  for each row execute function public.log_platform_settings();

-- ---------------------------------------------------------------------------
-- Prefijos de folio · DB-09 (versión de 20261021000100_membresias.sql)
-- ---------------------------------------------------------------------------
-- Sin dígito final: con "V-1" el folio 1001 sería "V-11001", igual que el 11001 de "V-".
create or replace function public.update_business(p_name text, p_order_prefix text, p_quote_prefix text)
returns public.businesses
language plpgsql security definer set search_path = public as $$
declare
  v public.businesses;
  v_name text := trim(coalesce(p_name, ''));
  v_order text := trim(coalesce(p_order_prefix, ''));
  v_quote text := trim(coalesce(p_quote_prefix, ''));
begin
  perform public.assert_member();
  if not public.is_owner() then raise exception 'Solo el dueño puede editar el negocio'; end if;
  if v_name = '' then raise exception 'El nombre del negocio es obligatorio'; end if;
  if v_order = '' or v_quote = '' then raise exception 'Los prefijos de folio no pueden estar vacíos'; end if;
  if length(v_order) > 10 or length(v_quote) > 10 then raise exception 'Los prefijos de folio admiten hasta 10 caracteres'; end if;
  if v_order !~ '^[A-Za-z0-9-]+$' or v_quote !~ '^[A-Za-z0-9-]+$' then
    raise exception 'Los prefijos de folio solo admiten letras, números y guion';
  end if;
  if v_order ~ '[0-9]$' or v_quote ~ '[0-9]$' then raise exception 'El prefijo debe terminar en letra o guion'; end if;
  update public.businesses set name = v_name, order_prefix = v_order, quote_prefix = v_quote
   where id = public.current_business_id()
  returning * into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_mark_paid con topes · DB-13 (versión de 20261025000100_plan_unico.sql)
-- ---------------------------------------------------------------------------
create or replace function public.admin_mark_paid(p_business uuid, p_months int, p_amount numeric, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare b public.businesses; v_paid timestamptz;
begin
  perform public.assert_platform_admin();
  if p_months is null or p_months not between 1 and 24 then raise exception 'Meses inválidos'; end if;
  if p_amount is not null and not (p_amount >= 0 and p_amount < 'Infinity') then raise exception 'Monto inválido'; end if;
  if length(p_note) > 500 then raise exception 'La nota admite hasta 500 caracteres'; end if;
  select * into b from public.businesses where id = p_business for update;
  if b.id is null then raise exception 'Negocio no encontrado'; end if;
  v_paid := greatest(b.paid_until, now()) + make_interval(months => p_months);
  update public.businesses set paid_until = v_paid where id = p_business;
  insert into public.membership_events (business_id, actor, action, paid_until, amount, note)
  values (p_business, auth.uid(), 'pago', v_paid, nullif(p_amount, 0), p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Logos: leer la carpeta exige membresía con acceso · DB-14 (versión de 20261019000400_storage.sql)
-- ---------------------------------------------------------------------------
drop policy "equipo lee logos de su negocio" on storage.objects;
create policy "equipo lee logos de su negocio" on storage.objects
  for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.current_business_id())::text
         and (select public.member_role()) is not null);

-- ---------------------------------------------------------------------------
-- Permisos de ejecución por defecto · DB-15
-- ---------------------------------------------------------------------------
-- El EXECUTE a PUBLIC es un default global: un "in schema public" no lo quita (probado). anon y authenticated sí son
-- defaults del esquema (los pone Supabase). Desde aquí toda función nueva necesita su grant explícito.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- Funciones de trigger: el trigger no necesita EXECUTE de quien inserta.
revoke execute on function public.handle_new_user(), public.ensure_stock_rows(), public.ensure_branch_stock_rows() from authenticated;

-- ---------------------------------------------------------------------------
-- Índices en llaves foráneas · DB-12 (parcial)
-- ---------------------------------------------------------------------------
create index if not exists orders_branch_idx on public.orders (branch);
create index if not exists movements_branch_idx on public.movements (branch);
create index if not exists expenses_branch_idx on public.expenses (branch);
create index if not exists quotes_customer_idx on public.quotes (customer_id);
create index if not exists business_members_branch_idx on public.business_members (branch);
