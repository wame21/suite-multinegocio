-- Suite multi-negocio · fase 1 (2/2): cuenta del dueño, giro y membresías por negocio.
-- · profiles guarda a la persona y su negocio activo; business_members guarda el puesto en cada negocio.
-- · current_business_id() sigue siendo la llave de todo el RLS: ahora sale del negocio activo.
-- · El registro sin código crea solo el perfil; el negocio se crea después con create_business().
-- Requiere 20261102000100_roles_restaurante.sql (roles mesero, cajero y cocina).

-- ---------------------------------------------------------------------------
-- Giro
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column kind text not null default 'boutique' check (kind in ('boutique', 'restaurante'));

-- ---------------------------------------------------------------------------
-- Membresías: de profiles a business_members
-- ---------------------------------------------------------------------------
create table public.business_members (
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  role public.app_role not null default 'pendiente',
  branch text references public.branches (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index business_members_business_idx on public.business_members (business_id);
create unique index business_members_un_dueno on public.business_members (business_id) where role = 'dueno';

alter table public.business_members enable row level security;
revoke all on public.business_members from anon, authenticated;
grant select on public.business_members to authenticated;

insert into public.business_members (user_id, business_id, role, branch, created_at)
select id, business_id, role, branch, created_at from public.profiles;

alter table public.profiles add column active_business_id uuid references public.businesses (id) on delete set null;
update public.profiles set active_business_id = business_id;

-- Nadie se pierde: si algo no coincide la migración entera se revierte.
do $$
declare n_profiles int; n_members int; n_diff int;
begin
  select count(*) into n_profiles from public.profiles;
  select count(*) into n_members from public.business_members;
  select count(*) into n_diff from public.profiles p
   where p.active_business_id is distinct from p.business_id
      or not exists (select 1 from public.business_members m
                      where m.user_id = p.id and m.business_id = p.business_id
                        and m.role = p.role and m.branch is not distinct from p.branch and m.created_at = p.created_at);
  if n_profiles <> n_members or n_diff > 0 then
    raise exception 'Migración de perfiles incompleta: % perfiles, % membresías, % sin coincidir', n_profiles, n_members, n_diff;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Funciones de acceso (versión de 20261027000100_revision_de_negocios.sql, ahora sobre business_members)
-- ---------------------------------------------------------------------------
-- Solo con membresía aprobada (cualquier rol salvo pendiente) en el negocio activo.
create or replace function public.current_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.active_business_id
    from public.profiles p
    join public.business_members m on m.user_id = p.id and m.business_id = p.active_business_id
   where p.id = auth.uid() and m.role <> 'pendiente'
$$;

-- Rol en el negocio activo si el cobro lo deja entrar (prueba, activa o gracia); null si no.
create function public.member_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select m.role
    from public.profiles p
    join public.business_members m on m.user_id = p.id and m.business_id = p.active_business_id
    join public.businesses b on b.id = m.business_id
    cross join lateral public.membership(b) s
   where p.id = auth.uid() and m.role <> 'pendiente' and s.state in ('prueba', 'activa', 'gracia')
$$;

-- Mesero, cajero y cocina quedan fuera a propósito: lo suyo se autoriza con member_role() en las tablas y RPC del restaurante.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role() in ('dueno', 'vendedor'), false)
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role() = 'dueno', false)
$$;

-- ---------------------------------------------------------------------------
-- Equipo
-- ---------------------------------------------------------------------------
drop function public.set_member(uuid, public.app_role, text);
create function public.set_member(p_id uuid, p_role public.app_role, p_branch text) returns public.business_members
language plpgsql security definer set search_path = public as $$
declare v public.business_members; v_business uuid := public.current_business_id(); v_kind text;
begin
  perform public.assert_member();
  if not public.is_owner() then raise exception 'Solo el dueño puede administrar el equipo'; end if;
  if p_id = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  if p_role = 'dueno' then raise exception 'Solo puede haber un dueño'; end if;
  select kind into v_kind from public.businesses where id = v_business;
  if p_role <> 'pendiente' and p_role::text <> all (case v_kind when 'restaurante' then array['mesero', 'cajero', 'cocina'] else array['vendedor'] end) then
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
-- Registro: sin código solo el perfil; con código, membresía pendiente en ese negocio
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, ''), '@', 1));
  v_code text := nullif(upper(trim(new.raw_user_meta_data ->> 'invite_code')), '');
  v_business uuid;
begin
  if v_code is not null then
    select id into v_business from public.businesses where invite_code = v_code;
    if v_business is null then raise exception 'Código de invitación inválido'; end if;
  end if;
  insert into public.profiles (id, name, email, active_business_id) values (new.id, v_name, new.email, v_business);
  if v_business is not null then
    insert into public.business_members (user_id, business_id, role) values (new.id, v_business, 'pendiente');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pedidos: la sucursal del vendedor ahora sale de su membresía (resto igual a 20261101000100_create_order_seguro.sql)
-- ---------------------------------------------------------------------------
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
    select branch into v_my_branch from public.business_members where user_id = auth.uid() and business_id = v_business;
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
$function$;

-- ---------------------------------------------------------------------------
-- Plataforma: giro en la lista de negocios; el dueño sale de business_members
-- ---------------------------------------------------------------------------
drop function public.admin_businesses();
create function public.admin_businesses()
returns table (id uuid, name text, kind text, owner_name text, owner_email text, state text, ends_at timestamptz,
               trial_ends_at timestamptz, paid_until timestamptz, suspended_at timestamptz, suspended_reason text,
               members integer, orders_30d integer, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  return query
    select b.id, b.name, b.kind, o.name, o.email, m.state, m.ends_at, b.trial_ends_at, b.paid_until, b.suspended_at, b.suspended_reason,
           (select count(*)::int from public.business_members x where x.business_id = b.id and x.role <> 'pendiente'),
           (select count(*)::int from public.orders r where r.business_id = b.id and r.date > now() - interval '30 days'),
           b.created_at
      from public.businesses b
      cross join lateral public.membership(b) m
      left join public.business_members d on d.business_id = b.id and d.role = 'dueno'
      left join public.profiles o on o.id = d.user_id
     order by b.created_at desc;
end;
$$;

-- Ahora devuelve también el giro: {name, kind}, o null si el código no existe.
drop function public.invite_lookup(text, text);
create function public.invite_lookup(p_code text, p_key text) returns json
language plpgsql security definer set search_path = public as $$
begin
  -- Serializa por llave: sin esto, una ráfaga en paralelo cuenta antes de que se guarden sus intentos.
  perform pg_advisory_xact_lock(hashtext('invite_lookup:' || p_key));
  delete from public.invite_attempts where at < now() - interval '1 hour';
  if (select count(*) from public.invite_attempts where key = p_key and at > now() - interval '10 minutes') >= 30 then
    -- PT429: PostgREST responde 429 y la función lo reconoce por el código.
    raise exception 'Demasiados intentos, espera unos minutos' using errcode = 'PT429';
  end if;
  insert into public.invite_attempts (key) values (p_key);
  return (select json_build_object('name', name, 'kind', kind) from public.businesses where invite_code = upper(trim(p_code)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cuenta del dueño
-- ---------------------------------------------------------------------------
-- Crea un negocio en revisión del que quien llama es el dueño; devuelve su id. No lo activa: usa set_active_business().
-- p_tables todavía no se guarda: la tarea de restaurante lo usará para crear las mesas con QR.
create function public.create_business(p_name text, p_kind text, p_profile jsonb default '{}', p_tables int default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if v_name = '' or length(v_name) > 80 then raise exception 'Nombre inválido'; end if;
  if p_kind is null or p_kind not in ('boutique', 'restaurante') then raise exception 'Giro inválido'; end if;
  if jsonb_typeof(coalesce(p_profile, '{}')) <> 'object' then raise exception 'Datos del negocio inválidos'; end if;
  if p_tables is null or p_tables < 0 or p_tables > 200 then raise exception 'Número de mesas inválido'; end if;
  -- Tope contra abuso: sin él, una sola cuenta podría llenar la base de negocios.
  if (select count(*) from public.business_members where user_id = auth.uid() and role = 'dueno') >= 10 then
    raise exception 'Llegaste al máximo de negocios por cuenta';
  end if;

  insert into public.businesses (name, kind) values (v_name, p_kind) returning id into v_id;
  perform public.seed_business_defaults(v_id);
  insert into public.business_members (user_id, business_id, role, branch)
  values (auth.uid(), v_id, 'dueno', (select id from public.branches where business_id = v_id and is_warehouse));

  -- Solo los datos de contacto y el color del formulario "Datos del negocio", cortos y como texto.
  update public.settings
     set value = value || (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_profile) e (k, v)
                            where k in ('legalName', 'phone', 'email', 'instagram', 'web', 'city', 'address', 'accentColor')
                              and jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 200)
   where business_id = v_id and key = 'profile';
  return v_id;
end;
$$;

create function public.set_active_business(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.business_members where user_id = auth.uid() and business_id = p_id) then
    raise exception 'Negocio no encontrado';
  end if;
  update public.profiles set active_business_id = p_id where id = auth.uid();
end;
$$;

-- Los negocios de quien llama (como dueño o como personal) para las cards de "Mis negocios".
-- Las ventas del mes (misma regla que owner_overview) solo se calculan donde es dueño.
-- shortcut: zona horaria fija de México; parametrizar si algún negocio opera en otra.
create function public.my_businesses() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
      'id', b.id, 'name', b.name, 'kind', b.kind, 'role', m.role, 'state', s.state, 'endsAt', s.ends_at,
      'rejectionReason', case when s.state = 'rechazada' then b.suspended_reason end,
      'monthSales', case when m.role = 'dueno' then coalesce((
          select sum(o.total) from public.orders o
           where o.business_id = b.id and o.status in ('pagado', 'enviado', 'entregado')
             and o.date >= date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'), 0) end,
      'active', b.id is not distinct from p.active_business_id, 'createdAt', b.created_at
    ) order by b.created_at), '[]'::json)
    from public.business_members m
    join public.businesses b on b.id = m.business_id
    join public.profiles p on p.id = m.user_id
    cross join lateral public.membership(b) s
   where m.user_id = auth.uid()
$$;

-- Estado de cobro de cada negocio del que quien llama es dueño, más los datos de pago (pantalla Membresías).
create function public.my_memberships() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'priceMonthly', s.price_monthly, 'priceSetup', s.price_setup,
    'payment', json_build_object('bank', s.bank, 'clabe', s.clabe, 'holder', s.holder, 'whatsapp', s.whatsapp),
    'businesses', coalesce((
      select json_agg(json_build_object(
          'id', b.id, 'name', b.name, 'kind', b.kind, 'state', ms.state, 'endsAt', ms.ends_at,
          'trialEndsAt', b.trial_ends_at, 'paidUntil', b.paid_until, 'suspendedReason', b.suspended_reason,
          'lastPayment', (select json_build_object('at', e.at, 'amount', e.amount, 'note', e.note)
                            from public.membership_events e where e.business_id = b.id and e.action = 'pago'
                           order by e.at desc limit 1)
        ) order by b.created_at)
        from public.business_members m
        join public.businesses b on b.id = m.business_id
        cross join lateral public.membership(b) ms
       where m.user_id = auth.uid() and m.role = 'dueno'), '[]'::json))
    from public.platform_settings s
$$;

-- Agregados de los negocios activos de quien llama (solo donde es dueño) entre p_from (incluido) y p_to (excluido),
-- y del periodo anterior de la misma duración. Las ventas siguen las reglas de src/lib/metrics.ts (pagado, enviado y
-- entregado; utilidad = ingresos - costo - gastos - comisiones estimadas). Hoy solo suma pedidos de boutique.
-- shortcut: zona horaria fija de México para meses, mejor día y hora pico; parametrizar si algún negocio opera en otra.
create function public.owner_overview(p_from timestamptz, p_to timestamptz) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'America/Mexico_City';
  v_prev timestamptz;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Rango inválido'; end if;
  v_prev := p_from - (p_to - p_from);
  return (
    with biz as (
      select b.id, b.name, b.kind
        from public.business_members m
        join public.businesses b on b.id = m.business_id
        cross join lateral public.membership(b) s
       where m.user_id = auth.uid() and m.role = 'dueno' and s.state in ('prueba', 'activa', 'gracia')
    ), sale as (
      select o.business_id, o.date as at, o.total, o.payments, o.date >= p_from as cur,
             coalesce((select sum((i ->> 'qty')::numeric * coalesce((c.costs ->> (i ->> 'variantKey'))::numeric, 0))
                         from jsonb_array_elements(o.items) i), 0) as cogs,
             coalesce((select sum((x ->> 'amount')::numeric * coalesce((st.value -> 'paymentFees' ->> (x ->> 'method'))::numeric, 0))
                         from jsonb_array_elements(o.payments) x), 0) as fees
        from public.orders o
        join biz on biz.id = o.business_id
        left join public.order_costs c on c.order_id = o.id
        left join public.settings st on st.business_id = o.business_id and st.key = 'sales'
       where o.status in ('pagado', 'enviado', 'entregado') and o.date >= v_prev and o.date < p_to
    ), spend as (
      select e.business_id, e.date as at, e.category, e.amount, e.date >= p_from as cur
        from public.expenses e
        join biz on biz.id = e.business_id
       where e.date >= v_prev and e.date < p_to
    ), per as (
      select biz.id, biz.name, biz.kind, w.cur,
             coalesce(s.revenue, 0) as revenue, coalesce(s.cogs, 0) as cogs, coalesce(s.fees, 0) as fees,
             coalesce(s.orders, 0) as orders, coalesce(e.expenses, 0) as expenses
        from biz
        cross join (values (true), (false)) w (cur)
        left join (select business_id, cur, sum(total) as revenue, sum(cogs) as cogs, sum(fees) as fees, count(*)::int as orders
                     from sale group by business_id, cur) s on s.business_id = biz.id and s.cur = w.cur
        left join (select business_id, cur, sum(amount) as expenses from spend group by business_id, cur) e
               on e.business_id = biz.id and e.cur = w.cur
    )
    select json_build_object(
      'from', p_from, 'to', p_to,
      'totals', (select json_build_object('revenue', coalesce(sum(revenue), 0), 'cogs', coalesce(sum(cogs), 0),
                        'expenses', coalesce(sum(expenses), 0), 'fees', coalesce(sum(fees), 0),
                        'profit', coalesce(sum(revenue - cogs - expenses - fees), 0), 'orders', coalesce(sum(orders), 0))
                   from per where cur),
      'previous', (select json_build_object('revenue', coalesce(sum(revenue), 0), 'cogs', coalesce(sum(cogs), 0),
                        'expenses', coalesce(sum(expenses), 0), 'fees', coalesce(sum(fees), 0),
                        'profit', coalesce(sum(revenue - cogs - expenses - fees), 0), 'orders', coalesce(sum(orders), 0))
                   from per where not cur),
      'businesses', coalesce((
        select json_agg(json_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'revenue', c.revenue, 'cogs', c.cogs,
                          'expenses', c.expenses, 'fees', c.fees, 'profit', c.revenue - c.cogs - c.expenses - c.fees,
                          'orders', c.orders, 'prevRevenue', pv.revenue,
                          'peakHour', (select json_build_object('dow', extract(dow from l)::int, 'hour', extract(hour from l)::int)
                                         from (select s.at at time zone v_tz as l from sale s where s.business_id = c.id and s.cur) t
                                        group by extract(dow from l), extract(hour from l)
                                        order by count(*) desc limit 1)
                        ) order by c.revenue desc)
          from per c join per pv on pv.id = c.id and not pv.cur where c.cur), '[]'::json),
      'byMonth', coalesce((
        select json_agg(json_build_object('businessId', business_id, 'month', mes, 'revenue', revenue, 'cogs', cogs, 'expenses', expenses)
                        order by mes, business_id)
          from (select business_id, mes, sum(revenue) as revenue, sum(cogs) as cogs, sum(expenses) as expenses
                  from (select business_id, (date_trunc('month', at at time zone v_tz))::date as mes, total as revenue, cogs, 0::numeric as expenses
                          from sale where cur
                        union all
                        select business_id, (date_trunc('month', at at time zone v_tz))::date, 0, 0, amount
                          from spend where cur) u
                 group by business_id, mes) g), '[]'::json),
      'paymentMethods', coalesce((
        select json_agg(json_build_object('businessId', business_id, 'method', method, 'amount', amount))
          from (select s.business_id, x ->> 'method' as method, sum((x ->> 'amount')::numeric) as amount
                  from sale s, jsonb_array_elements(s.payments) x where s.cur group by 1, 2) g), '[]'::json),
      'expenseCategories', coalesce((
        select json_agg(json_build_object('businessId', business_id, 'category', category, 'amount', amount))
          from (select business_id, category, sum(amount) as amount from spend where cur group by 1, 2) g), '[]'::json),
      'bestDay', (select json_build_object('day', d, 'revenue', r)
                    from (select (at at time zone v_tz)::date as d, sum(total) as r from sale where cur group by 1 order by 2 desc limit 1) t)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución: nada para anon.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.member_role(), public.set_member(uuid, public.app_role, text), public.admin_businesses(),
  public.create_business(text, text, jsonb, int), public.set_active_business(uuid), public.my_businesses(),
  public.my_memberships(), public.owner_overview(timestamptz, timestamptz), public.invite_lookup(text, text)
  from public, anon, authenticated;
grant execute on function
  public.member_role(), public.set_member(uuid, public.app_role, text), public.admin_businesses(),
  public.create_business(text, text, jsonb, int), public.set_active_business(uuid), public.my_businesses(),
  public.my_memberships(), public.owner_overview(timestamptz, timestamptz)
  to authenticated;
grant execute on function public.invite_lookup(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Perfil: solo la persona. Lectura propia, o de los miembros del negocio activo si quien llama es su dueño.
-- ---------------------------------------------------------------------------
drop policy "perfil propio o dueño" on public.profiles;
create policy "perfil propio o dueño del negocio" on public.profiles for select to authenticated using (
  id = auth.uid()
  or ((select public.is_owner()) and exists (
        select 1 from public.business_members m
         where m.user_id = profiles.id and m.business_id = (select public.current_business_id())))
);

create policy "membresía propia o dueño del negocio" on public.business_members for select to authenticated using (
  user_id = auth.uid()
  or (business_id = (select public.current_business_id()) and (select public.is_owner()))
);

alter table public.profiles drop column business_id, drop column role, drop column branch;
