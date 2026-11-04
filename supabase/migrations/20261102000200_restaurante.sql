-- Suite multi-negocio · restaurante: mesas con QR, menú con modificadores, pedidos de mesa y su lado público.
-- Requiere 20261102000101_multinegocio.sql (member_role(), business_members, businesses.kind).
-- · El personal (dueno, mesero, cajero, cocina) lee; solo el dueño edita menú, mesas y configuración.
-- · Los pedidos solo se escriben por RPC (security definer): el cliente nunca fija precios, estados ni tokens.
-- · El comensal anónimo solo entra por table_menu / table_order_status / table_order_transfer_notice (anon)
--   y por place_table_order (solo service_role, vía la Edge Function table-order).

-- Token aleatorio de 244 bits (dos uuid v4 sin guiones); sirve para el QR de la mesa y el seguimiento del pedido.
create function public.new_token() returns text
language sql volatile as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

create function public.is_restaurant_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role() in ('dueno', 'mesero', 'cajero', 'cocina'), false)
$$;

-- Folio consecutivo de los pedidos de mesa (prefijo en settings.restaurant.folioPrefix).
alter table public.businesses add column next_table_folio integer not null default 1;

-- ---------------------------------------------------------------------------
-- Mesas
-- ---------------------------------------------------------------------------
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  area text not null default '' check (length(area) <= 40),
  qr_token text not null unique default public.new_token(),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, name)
);

-- ---------------------------------------------------------------------------
-- Menú
-- ---------------------------------------------------------------------------
-- modifiers = [{id, nombre, obligatorio, min, max, opciones:[{id, nombre, precio_extra, disponible}]}]
create function public.valid_modifiers(m jsonb) returns boolean
language plpgsql immutable as $$
declare g jsonb; o jsonb; gids text[] := '{}'; oids text[];
begin
  if jsonb_typeof(m) is distinct from 'array' or jsonb_array_length(m) > 20 then return false; end if;
  for g in select value from jsonb_array_elements(m) loop
    if jsonb_typeof(g) is distinct from 'object'
       or jsonb_typeof(g -> 'id') is distinct from 'string' or length(g ->> 'id') not between 1 and 40
       or jsonb_typeof(g -> 'nombre') is distinct from 'string' or length(g ->> 'nombre') not between 1 and 80
       or jsonb_typeof(g -> 'obligatorio') is distinct from 'boolean'
       or jsonb_typeof(g -> 'min') is distinct from 'number' or (g ->> 'min') !~ '^\d{1,3}$'
       or jsonb_typeof(g -> 'max') is distinct from 'number' or (g ->> 'max') !~ '^\d{1,3}$'
       or (g ->> 'max')::int < greatest((g ->> 'min')::int, 1)
       or jsonb_typeof(g -> 'opciones') is distinct from 'array' or jsonb_array_length(g -> 'opciones') > 50
       or g ->> 'id' = any (gids) then
      return false;
    end if;
    gids := gids || (g ->> 'id');
    oids := '{}';
    for o in select value from jsonb_array_elements(g -> 'opciones') loop
      if jsonb_typeof(o) is distinct from 'object'
         or jsonb_typeof(o -> 'id') is distinct from 'string' or length(o ->> 'id') not between 1 and 40
         or jsonb_typeof(o -> 'nombre') is distinct from 'string' or length(o ->> 'nombre') not between 1 and 80
         or jsonb_typeof(o -> 'precio_extra') is distinct from 'number' or (o ->> 'precio_extra') !~ '^\d{1,6}(\.\d{1,2})?$'
         or jsonb_typeof(o -> 'disponible') is distinct from 'boolean'
         or o ->> 'id' = any (oids) then
        return false;
      end if;
      oids := oids || (o ->> 'id');
    end loop;
  end loop;
  return true;
end;
$$;

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort integer not null default 0,
  unique (id, business_id)
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  category_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  price numeric(12, 2) not null check (price >= 0),
  photo text check (length(photo) <= 500),
  available boolean not null default true,
  sort integer not null default 0,
  modifiers jsonb not null default '[]' check (public.valid_modifiers(modifiers)),
  unique (id, business_id),
  foreign key (category_id, business_id) references public.menu_categories (id, business_id)
);
create index menu_items_business_idx on public.menu_items (business_id);

-- El costo del platillo solo lo ve el dueño (mismo patrón que product_costs).
create table public.menu_item_costs (
  item_id uuid primary key,
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  foreign key (item_id, business_id) references public.menu_items (id, business_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Pedidos de mesa
-- ---------------------------------------------------------------------------
-- items = [{itemId, name, qty, basePrice, unitPrice, note, lineTotal, options:[{groupId, group, optionId, name, extra}]}]
-- Es una foto: no cambia si el dueño edita el menú después.
create table public.table_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  table_id uuid not null,
  folio text not null,
  customer_name text not null check (length(customer_name) between 1 and 40),
  items jsonb not null,
  note text check (length(note) <= 300),
  total numeric(12, 2) not null check (total >= 0),
  payment_method text not null check (payment_method in ('efectivo', 'tarjeta', 'transferencia')),
  card_at_table boolean not null default false,
  status text not null default 'por_pagar'
    check (status in ('por_pagar', 'pagado', 'en_preparacion', 'terminado', 'entregado', 'cancelado')),
  tracking_token text not null unique default public.new_token(),
  transfer_notice_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  unique (id, business_id),
  unique (business_id, folio),
  foreign key (table_id, business_id) references public.dining_tables (id, business_id)
);
create index table_orders_open_idx on public.table_orders (business_id, status, created_at);
create index table_orders_table_idx on public.table_orders (table_id);

-- Costo del pedido al momento de pedir; solo el dueño lo ve.
create table public.table_order_costs (
  order_id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  cost numeric(12, 2) not null default 0,
  foreign key (order_id, business_id) references public.table_orders (id, business_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------
alter table public.dining_tables enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_item_costs enable row level security;
alter table public.table_orders enable row level security;
alter table public.table_order_costs enable row level security;

revoke all on public.dining_tables, public.menu_categories, public.menu_items, public.menu_item_costs,
  public.table_orders, public.table_order_costs from anon, authenticated;
grant select on public.dining_tables, public.menu_categories, public.menu_items, public.table_orders to authenticated;
grant select, insert, update, delete on public.menu_categories, public.menu_items, public.menu_item_costs to authenticated;
-- qr_token no se escribe desde el cliente: nace aleatorio y solo regenerate_table_qr() lo cambia.
grant insert (business_id, name, area, active, sort), update (name, area, active, sort), delete on public.dining_tables to authenticated;
grant select on public.table_order_costs to authenticated;
grant execute on function public.new_token() to authenticated;

-- Todo el personal lee; solo el dueño escribe.
create policy "personal lee mesas" on public.dining_tables for select to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_restaurant_staff()));
create policy "dueño gestiona mesas" on public.dining_tables for all to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_owner()))
  with check (business_id = (select public.current_business_id()) and (select public.is_owner()));

create policy "personal lee categorías" on public.menu_categories for select to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_restaurant_staff()));
create policy "dueño gestiona categorías" on public.menu_categories for all to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_owner()))
  with check (business_id = (select public.current_business_id()) and (select public.is_owner()));

create policy "personal lee menú" on public.menu_items for select to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_restaurant_staff()));
create policy "dueño gestiona menú" on public.menu_items for all to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_owner()))
  with check (business_id = (select public.current_business_id()) and (select public.is_owner()));

create policy "dueño gestiona costos del menú" on public.menu_item_costs for all to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_owner()))
  with check (business_id = (select public.current_business_id()) and (select public.is_owner()));

create policy "personal lee pedidos de mesa" on public.table_orders for select to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_restaurant_staff()));
create policy "dueño lee costos de pedidos de mesa" on public.table_order_costs for select to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_owner()));

-- El personal del restaurante lee solo la configuración que su pantalla necesita (settings.is_member() los excluye).
create policy "personal del restaurante lee su configuración" on public.settings for select to authenticated
  using (business_id = (select public.current_business_id()) and key in ('restaurant', 'profile') and (select public.is_restaurant_staff()));

-- Pedidos en vivo para el personal (patrón postgres_changes).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_orders') then
    alter publication supabase_realtime add table public.table_orders;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuración inicial y mesas al crear el negocio (misma firma que 20261102000101_multinegocio.sql)
-- ---------------------------------------------------------------------------
create or replace function public.create_business(p_name text, p_kind text, p_profile jsonb default '{}', p_tables int default 0) returns uuid
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

  if p_kind = 'restaurante' then
    -- seed_business_defaults siembra datos de boutique: aquí sobran el catálogo de ropa, el mayoreo y los canales de envío.
    delete from public.settings where business_id = v_id and key in ('catalog', 'wholesale');
    update public.settings set value = jsonb_build_object('paymentFees', value -> 'paymentFees')
     where business_id = v_id and key = 'sales';
    insert into public.settings (business_id, key, value) values (v_id, 'restaurant', '{
      "cardAtTable": false,
      "methods": ["efectivo", "tarjeta"],
      "transfer": { "bank": "", "holder": "", "clabe": "" },
      "folioPrefix": "A"
    }'::jsonb);
    insert into public.dining_tables (business_id, name, sort)
    select v_id, 'Mesa ' || n, n from generate_series(1, p_tables) n;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC del personal
-- ---------------------------------------------------------------------------
-- "Regenerar QR": el QR impreso anterior deja de funcionar.
create function public.regenerate_table_qr(p_id uuid) returns public.dining_tables
language plpgsql security definer set search_path = public as $$
declare v public.dining_tables;
begin
  if not public.is_owner() then raise exception 'Solo el dueño puede regenerar el QR'; end if;
  update public.dining_tables set qr_token = public.new_token()
   where id = p_id and business_id = public.current_business_id() returning * into v;
  if v.id is null then raise exception 'Mesa no encontrada'; end if;
  return v;
end;
$$;

-- Único camino para cambiar el estado de un pedido. El dueño puede todo; cada puesto, solo lo suyo:
--   cajero: por_pagar→pagado y por_pagar→cancelado · mesero: por_pagar→pagado (solo tarjeta en la mesa con cardAtTable activo)
--   y terminado→entregado · cocina: pagado→en_preparacion→terminado.
create function public.set_table_order_status(p_id uuid, p_status text) returns public.table_orders
language plpgsql security definer set search_path = public as $$
declare v_role public.app_role := public.member_role(); o public.table_orders; v_ok boolean;
begin
  if v_role is null or v_role not in ('dueno', 'mesero', 'cajero', 'cocina') then raise exception 'No autorizado'; end if;
  select * into o from public.table_orders where id = p_id and business_id = public.current_business_id() for update;
  if o.id is null then raise exception 'Pedido no encontrado'; end if;
  if (o.status, p_status) not in (('por_pagar', 'pagado'), ('pagado', 'en_preparacion'), ('en_preparacion', 'terminado'),
                                  ('terminado', 'entregado'), ('por_pagar', 'cancelado')) then
    raise exception 'Ese cambio de estado no está permitido';
  end if;
  v_ok := v_role = 'dueno' or case p_status
    when 'pagado' then v_role = 'cajero' or (v_role = 'mesero' and o.card_at_table and coalesce(
      (select (value ->> 'cardAtTable')::boolean from public.settings where business_id = o.business_id and key = 'restaurant'), false))
    when 'en_preparacion' then v_role = 'cocina'
    when 'terminado' then v_role = 'cocina'
    when 'entregado' then v_role = 'mesero'
    when 'cancelado' then v_role = 'cajero'
  end;
  if not coalesce(v_ok, false) then raise exception 'Tu puesto no puede hacer este cambio'; end if;
  update public.table_orders set status = p_status,
    paid_at = case when p_status = 'pagado' then now() else paid_at end,
    preparing_at = case when p_status = 'en_preparacion' then now() else preparing_at end,
    ready_at = case when p_status = 'terminado' then now() else ready_at end,
    delivered_at = case when p_status = 'entregado' then now() else delivered_at end,
    cancelled_at = case when p_status = 'cancelado' then now() else cancelled_at end
   where id = o.id returning * into o;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lado público (comensal anónimo)
-- ---------------------------------------------------------------------------
-- Menú de la mesa del QR; null si el token no existe, la mesa está inactiva o el restaurante no opera.
create function public.table_menu(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business', json_build_object('name', b.name, 'logoUrl', pr.value ->> 'logoUrl', 'accentColor', pr.value ->> 'accentColor'),
    'table', json_build_object('name', t.name, 'area', t.area),
    'cardAtTable', coalesce((cf.value ->> 'cardAtTable')::boolean, false),
    'methods', coalesce(cf.value -> 'methods', '["efectivo"]'::jsonb),
    'categories', coalesce((
      select json_agg(json_build_object('id', c.id, 'name', c.name, 'items', coalesce((
          select json_agg(json_build_object('id', i.id, 'name', i.name, 'description', i.description, 'price', i.price,
                                            'photo', i.photo, 'modifiers', i.modifiers) order by i.sort, i.name)
            from public.menu_items i where i.category_id = c.id and i.available), '[]'::json)) order by c.sort, c.name)
        from public.menu_categories c where c.business_id = b.id), '[]'::json))
    from public.dining_tables t
    join public.businesses b on b.id = t.business_id
    cross join lateral public.membership(b) m
    left join public.settings cf on cf.business_id = b.id and cf.key = 'restaurant'
    left join public.settings pr on pr.business_id = b.id and pr.key = 'profile'
   where t.qr_token = p_token and t.active and b.kind = 'restaurante' and m.state in ('prueba', 'activa', 'gracia')
$$;

-- Estado de un solo pedido, por su token de seguimiento; null si no existe. Los datos de transferencia solo salen
-- si el pedido es por transferencia.
create function public.table_order_status(p_tracking text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'folio', o.folio, 'status', o.status, 'customerName', o.customer_name, 'items', o.items, 'note', o.note,
    'total', o.total, 'paymentMethod', o.payment_method, 'cardAtTable', o.card_at_table,
    'transferNotified', o.transfer_notice_at is not null, 'table', t.name, 'business', b.name,
    'transfer', case when o.payment_method = 'transferencia' then cf.value -> 'transfer' end,
    'createdAt', o.created_at, 'paidAt', o.paid_at, 'preparingAt', o.preparing_at, 'readyAt', o.ready_at,
    'deliveredAt', o.delivered_at, 'cancelledAt', o.cancelled_at)
    from public.table_orders o
    join public.dining_tables t on t.id = o.table_id
    join public.businesses b on b.id = o.business_id
    left join public.settings cf on cf.business_id = b.id and cf.key = 'restaurant'
   where o.tracking_token = p_tracking
$$;

-- "Ya transferí": marca el pedido para que caja lo revise. No hay comprobante: caja lo confirma en el banco.
-- Es idempotente y exige el token de seguimiento, que no se puede adivinar.
create function public.table_order_transfer_notice(p_tracking text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.table_orders set transfer_notice_at = coalesce(transfer_notice_at, now())
   where tracking_token = p_tracking and status = 'por_pagar' and payment_method = 'transferencia';
  if not found then raise exception 'Pedido no disponible'; end if;
end;
$$;

-- Crea el pedido recalculando todo en el servidor (precios, modificadores, total). Solo service_role (Edge Function
-- table-order); p_key es la IP que pone la función. Los errores de validación llevan errcode PT422 (HTTP 422) y el
-- límite PT429. shortcut: el límite por IP cuenta solo pedidos creados (un rechazo revierte su intento); suficiente
-- porque el rechazo no escribe nada. Las IP compartidas (Wi-Fi del local) comparten el tope de 30 pedidos / 10 min.
create function public.place_table_order(p_token text, p_name text, p_items jsonb, p_note text, p_method text, p_key text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  c_open constant int := 8;  -- pedidos abiertos por mesa
  v_tbl public.dining_tables; v_cfg jsonb;
  v_name text := trim(coalesce(p_name, '')); v_note text := nullif(trim(coalesce(p_note, '')), '');
  it jsonb; v_menu public.menu_items; g jsonb; s jsonb; opt jsonb; v_sel jsonb; v_opts jsonb;
  v_lines jsonb := '[]'; v_qty int; v_unit numeric; v_total numeric := 0; v_cost numeric := 0;
  v_n int; v_min int; v_inote text; v_folio text; v_card boolean; v_order public.table_orders;
begin
  perform pg_advisory_xact_lock(hashtext('place_table_order:' || p_key));
  delete from public.invite_attempts where at < now() - interval '1 hour';
  if (select count(*) from public.invite_attempts where key = p_key and at > now() - interval '10 minutes') >= 30 then
    raise exception 'Demasiados intentos, espera unos minutos' using errcode = 'PT429';
  end if;

  select * into v_tbl from public.dining_tables where qr_token = p_token for update;
  if v_tbl.id is null or not v_tbl.active then raise exception 'Mesa no disponible' using errcode = 'PT422'; end if;
  if not exists (select 1 from public.businesses b cross join lateral public.membership(b) m
                  where b.id = v_tbl.business_id and b.kind = 'restaurante' and m.state in ('prueba', 'activa', 'gracia')) then
    raise exception 'Restaurante no disponible' using errcode = 'PT422';
  end if;
  select value into v_cfg from public.settings where business_id = v_tbl.business_id and key = 'restaurant';
  v_cfg := coalesce(v_cfg, '{}');

  if length(v_name) not between 1 and 40 then raise exception 'Escribe tu nombre (máximo 40 letras)' using errcode = 'PT422'; end if;
  if length(v_note) > 300 then raise exception 'La nota es muy larga' using errcode = 'PT422'; end if;
  if p_method is null or p_method not in ('efectivo', 'tarjeta', 'transferencia')
     or not (coalesce(v_cfg -> 'methods', '["efectivo"]'::jsonb) ? p_method) then
    raise exception 'Método de pago no disponible' using errcode = 'PT422';
  end if;
  v_card := p_method = 'tarjeta' and coalesce((v_cfg ->> 'cardAtTable')::boolean, false);
  if (select count(*) from public.table_orders
       where table_id = v_tbl.id and status in ('por_pagar', 'pagado', 'en_preparacion', 'terminado')) >= c_open then
    raise exception 'Esta mesa tiene muchos pedidos abiertos, avisa al personal' using errcode = 'PT422';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'El pedido no tiene productos' using errcode = 'PT422';
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) is distinct from 'object' or (it ->> 'qty') !~ '^\d{1,2}$' or (it ->> 'qty')::int not between 1 and 20 then
      raise exception 'Cantidad inválida' using errcode = 'PT422';
    end if;
    v_qty := (it ->> 'qty')::int;
    v_inote := nullif(trim(coalesce(it ->> 'note', '')), '');
    if length(v_inote) > 140 then raise exception 'La nota del producto es muy larga' using errcode = 'PT422'; end if;
    select * into v_menu from public.menu_items
     where id::text = it ->> 'itemId' and business_id = v_tbl.business_id and available;
    if v_menu.id is null then raise exception 'Un producto ya no está disponible' using errcode = 'PT422'; end if;

    v_sel := coalesce(it -> 'options', '[]'::jsonb);
    if jsonb_typeof(v_sel) is distinct from 'array' or jsonb_array_length(v_sel) > 30 then
      raise exception 'Opciones inválidas' using errcode = 'PT422';
    end if;
    -- Una selección que apunta a un grupo que el producto no tiene no se ignora: se rechaza.
    if exists (select 1 from jsonb_array_elements(v_sel) x
                where not exists (select 1 from jsonb_array_elements(v_menu.modifiers) m where m ->> 'id' = x ->> 'groupId')) then
      raise exception 'Opciones inválidas' using errcode = 'PT422';
    end if;

    v_unit := v_menu.price; v_opts := '[]';
    for g in select value from jsonb_array_elements(v_menu.modifiers) loop
      v_n := (select count(*) from jsonb_array_elements(v_sel) x where x ->> 'groupId' = g ->> 'id');
      v_min := greatest((g ->> 'min')::int, case when (g ->> 'obligatorio')::boolean then 1 else 0 end);
      if v_n < v_min or v_n > (g ->> 'max')::int then
        raise exception 'Elige entre % y % opciones en "%" de "%"', v_min, g ->> 'max', g ->> 'nombre', v_menu.name using errcode = 'PT422';
      end if;
      if (select count(distinct x ->> 'optionId') from jsonb_array_elements(v_sel) x where x ->> 'groupId' = g ->> 'id') <> v_n then
        raise exception 'Opción repetida en "%"', g ->> 'nombre' using errcode = 'PT422';
      end if;
      for s in select value from jsonb_array_elements(v_sel) x where x ->> 'groupId' = g ->> 'id' loop
        select value into opt from jsonb_array_elements(g -> 'opciones')
         where value ->> 'id' = s ->> 'optionId' and (value ->> 'disponible')::boolean;
        if opt is null then raise exception 'Una opción de "%" ya no está disponible', g ->> 'nombre' using errcode = 'PT422'; end if;
        v_unit := v_unit + (opt ->> 'precio_extra')::numeric;
        v_opts := v_opts || jsonb_build_array(jsonb_build_object('groupId', g ->> 'id', 'group', g ->> 'nombre',
          'optionId', opt ->> 'id', 'name', opt ->> 'nombre', 'extra', (opt ->> 'precio_extra')::numeric));
      end loop;
    end loop;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object('itemId', v_menu.id, 'name', v_menu.name, 'qty', v_qty,
      'basePrice', v_menu.price, 'unitPrice', v_unit, 'note', v_inote, 'lineTotal', v_unit * v_qty, 'options', v_opts));
    v_total := v_total + v_unit * v_qty;
    v_cost := v_cost + v_qty * coalesce((select cost from public.menu_item_costs where item_id = v_menu.id), 0);
  end loop;

  update public.businesses set next_table_folio = next_table_folio + 1 where id = v_tbl.business_id
  returning coalesce(nullif(left(v_cfg ->> 'folioPrefix', 4), ''), 'A') || '-' || (next_table_folio - 1) into v_folio;

  insert into public.table_orders (business_id, table_id, folio, customer_name, items, note, total, payment_method, card_at_table)
  values (v_tbl.business_id, v_tbl.id, v_folio, v_name, v_lines, v_note, v_total, p_method, v_card)
  returning * into v_order;
  insert into public.table_order_costs (order_id, business_id, cost) values (v_order.id, v_order.business_id, v_cost);
  insert into public.invite_attempts (key) values (p_key);

  return json_build_object('trackingToken', v_order.tracking_token, 'folio', v_order.folio, 'status', v_order.status,
                           'total', v_order.total, 'paymentMethod', v_order.payment_method, 'cardAtTable', v_order.card_at_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ventas del restaurante en las vistas del dueño (versión de 20261102000101_multinegocio.sql)
-- ---------------------------------------------------------------------------

-- Los negocios de quien llama (como dueño o como personal) para las cards de "Mis negocios".
-- Las ventas del mes (misma regla que owner_overview) solo se calculan donde es dueño.
-- shortcut: zona horaria fija de México; parametrizar si algún negocio opera en otra.
create or replace function public.my_businesses() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
      'id', b.id, 'name', b.name, 'kind', b.kind, 'role', m.role, 'state', s.state, 'endsAt', s.ends_at,
      'rejectionReason', case when s.state = 'rechazada' then b.suspended_reason end,
      'monthSales', case when m.role = 'dueno' then coalesce((
          select sum(o.total) from public.orders o
           where o.business_id = b.id and o.status in ('pagado', 'enviado', 'entregado')
             and o.date >= date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'), 0)
        + coalesce((
          select sum(t.total) from public.table_orders t
           where t.business_id = b.id and t.paid_at >= date_trunc('month', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'), 0) end,
      'active', b.id is not distinct from p.active_business_id, 'createdAt', b.created_at
    ) order by b.created_at), '[]'::json)
    from public.business_members m
    join public.businesses b on b.id = m.business_id
    join public.profiles p on p.id = m.user_id
    cross join lateral public.membership(b) s
   where m.user_id = auth.uid()
$$;

-- Agregados de los negocios activos de quien llama (solo donde es dueño) entre p_from (incluido) y p_to (excluido),
-- y del periodo anterior de la misma duración. Las ventas siguen las reglas de src/lib/metrics.ts (pagado, enviado y
-- entregado; utilidad = ingresos - costo - gastos - comisiones estimadas). Suma también los pedidos de mesa del restaurante desde que se confirma su pago.
-- shortcut: zona horaria fija de México para meses, mejor día y hora pico; parametrizar si algún negocio opera en otra.
create or replace function public.owner_overview(p_from timestamptz, p_to timestamptz) returns json
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
      union all
      -- Restaurante: el cobro cuenta desde que se confirma el pago (paid_at); cancelados nunca lo tienen.
      select t.business_id, t.paid_at, t.total, jsonb_build_array(jsonb_build_object('method', t.payment_method, 'amount', t.total)),
             t.paid_at >= p_from, coalesce(c.cost, 0),
             t.total * coalesce((st.value -> 'paymentFees' ->> t.payment_method)::numeric, 0)
        from public.table_orders t
        join biz on biz.id = t.business_id
        left join public.table_order_costs c on c.order_id = t.id
        left join public.settings st on st.business_id = t.business_id and st.key = 'sales'
       where t.paid_at >= v_prev and t.paid_at < p_to
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
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function
  public.is_restaurant_staff(), public.regenerate_table_qr(uuid), public.set_table_order_status(uuid, text),
  public.table_menu(text), public.table_order_status(text), public.table_order_transfer_notice(text),
  public.place_table_order(text, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.is_restaurant_staff(), public.regenerate_table_qr(uuid), public.set_table_order_status(uuid, text)
  to authenticated;
grant execute on function public.table_menu(text), public.table_order_status(text), public.table_order_transfer_notice(text)
  to anon, authenticated;
grant execute on function public.place_table_order(text, text, jsonb, text, text, text) to service_role;
