-- Pruebas de supabase/migrations/20261103000101_auditoria_pendientes.sql. Todo dentro de BEGIN … ROLLBACK: no deja datos.
-- Uso: docker exec -i supabase_db_clotinghluiggi psql -U postgres -v ON_ERROR_STOP=0 < scripts/auditoria-pendientes.sql
-- Cada caso imprime PASS/FAIL (y el error recibido); al final, el resumen. Sesión simulada con set local role + request.jwt.claims.
\pset tuples_only on
\pset format unaligned
\pset footer off

begin;

-- ---------------------------------------------------------------------------
-- Ayudantes (se borran con el ROLLBACK). Invoker: corren con el rol de la sesión simulada.
-- ---------------------------------------------------------------------------
create function public.zz_cuenta(p_ok boolean) returns void language sql as $$
  select set_config('zz.' || case when p_ok then 'pass' else 'fail' end,
    (coalesce(nullif(current_setting('zz.' || case when p_ok then 'pass' else 'fail' end, true), ''), '0')::int + 1)::text, true)
$$;
-- Ejecuta p_sql; sin p_expect espera éxito, con p_expect espera un error que lo contenga.
create function public.zz_t(p_label text, p_sql text, p_expect text default null) returns text language plpgsql as $$
declare v_err text; v_ok boolean;
begin
  begin
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  v_ok := case when p_expect is null then v_err is null else coalesce(v_err ilike '%' || p_expect || '%', false) end;
  perform public.zz_cuenta(v_ok);
  return case when v_ok then 'PASS ' else 'FAIL ' end || p_label || coalesce(' → ' || v_err, '');
end $$;
create function public.zz_ok(p_label text, p_cond boolean) returns text language plpgsql as $$
begin
  perform public.zz_cuenta(coalesce(p_cond, false));
  return case when coalesce(p_cond, false) then 'PASS ' else 'FAIL ' end || p_label;
end $$;
create function public.zz_como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
-- Renglones de zz-prod-1 (lista $500): p_s piezas talla S y p_m talla M a p_price.
create function public.zz_items(p_s int, p_m int, p_price numeric) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('productId', 'zz-prod-1', 'variantKey', 'zz-prod-1|Negro|' || sz, 'name', 'ZZ Blusa',
           'color', 'Negro', 'size', sz, 'qty', q, 'unitPrice', p_price, 'unitCost', 1, 'listPrice', 500)), '[]'::jsonb)
    from (values ('S', p_s), ('M', p_m)) v (sz, q) where q <> 0
$$;
create function public.zz_pedido(p_items jsonb, p_tier text default null, p_customer text default null) returns jsonb language sql as $$
  select jsonb_build_object('channel', 'web', 'customerName', 'ZZ Cliente', 'customerId', p_customer, 'branch', current_setting('t.brP'),
                            'items', p_items, 'payments', '[]'::jsonb, 'tierId', p_tier, 'shipping', 0)
$$;
-- Totales falsos a propósito: el servidor los recalcula.
create function public.zz_cot(p_items jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customerId', 'zz-cli-men', 'customerName', 'ZZ Cliente', 'items', p_items, 'tierId', 'lista',
                            'subtotalList', 1, 'discount', 0, 'subtotal', 1, 'shipping', 100, 'total', 1, 'depositPct', 0.5,
                            'status', 'enviada', 'validUntil', now() + interval '7 days') || p_extra
$$;
create function public.zz_stock(p_vk text, p_branch text) returns int language sql security definer set search_path = public as $$
  select qty from public.stock where variant_key = p_vk and branch = p_branch
$$;
grant execute on function public.zz_cuenta(boolean), public.zz_t(text, text, text), public.zz_ok(text, boolean), public.zz_como(uuid),
  public.zz_items(int, int, numeric), public.zz_pedido(jsonb, text, text), public.zz_cot(jsonb, jsonb), public.zz_stock(text, text)
  to authenticated, anon;

\echo == Fixture
-- dueño A, vendedor, encargado, colaborador de A, dueño R (restaurante), colaborador de R, administrador de la plataforma
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'zz-duenoa@prueba.local', '{"name":"ZZ Dueño A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'zz-vendedor@prueba.local', '{"name":"ZZ Vendedor"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000c', 'zz-encargado@prueba.local', '{"name":"ZZ Encargado"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000d', 'zz-colaa@prueba.local', '{"name":"ZZ Colaborador A"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000e', 'zz-duenor@prueba.local', '{"name":"ZZ Dueño R"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000f', 'zz-colar@prueba.local', '{"name":"ZZ Colaborador R"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000010', 'zz-admin@prueba.local', '{"name":"ZZ Admin"}', 'authenticated', 'authenticated');
select public.zz_ok('DB-15 handle_new_user sigue creando el perfil (sin EXECUTE para authenticated)',
  (select count(*) from public.profiles where email like 'zz-%@prueba.local') = 7);
insert into public.platform_admins (user_id) values ('00000000-0000-4000-a000-000000000010');

set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-00000000000a');
select set_config('t.bizA', public.create_business('ZZ Boutique', 'boutique')::text, true) is not null;
select public.set_active_business(current_setting('t.bizA')::uuid);
select public.zz_como('00000000-0000-4000-a000-00000000000e');
select set_config('t.bizR', public.create_business('ZZ Resto', 'restaurante')::text, true) is not null;
select public.set_active_business(current_setting('t.bizR')::uuid);
reset role;

update public.businesses set approved_at = now() where id in (current_setting('t.bizA')::uuid, current_setting('t.bizR')::uuid);
select set_config('t.brP', (select id from public.branches where business_id = current_setting('t.bizA')::uuid), true) is not null;
insert into public.business_members (user_id, business_id, role, branch) values
  ('00000000-0000-4000-a000-00000000000b', current_setting('t.bizA')::uuid, 'vendedor', current_setting('t.brP')),
  ('00000000-0000-4000-a000-00000000000c', current_setting('t.bizA')::uuid, 'encargado', current_setting('t.brP')),
  ('00000000-0000-4000-a000-00000000000d', current_setting('t.bizA')::uuid, 'pendiente', null),
  ('00000000-0000-4000-a000-00000000000f', current_setting('t.bizR')::uuid, 'pendiente', null);
update public.profiles set active_business_id = current_setting('t.bizA')::uuid
 where id in ('00000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-00000000000c', '00000000-0000-4000-a000-00000000000d');
update public.profiles set active_business_id = current_setting('t.bizR')::uuid where id = '00000000-0000-4000-a000-00000000000f';
-- Niveles: lista (1 pz), mayoreo (12 pzs, −20 % → piso $400), distribuidor (50 pzs, −30 % → piso $350); distribuidor desde 24 pzs.
update public.settings set value = value || '{"tiers":[
    {"id":"lista","name":"Lista","minPieces":1,"discount":0},
    {"id":"mayoreo","name":"Mayoreo","minPieces":12,"discount":0.2},
    {"id":"distribuidor","name":"Distribuidor","minPieces":50,"discount":0.3}],
  "distributorCustomerMin":24}'::jsonb
 where business_id = current_setting('t.bizA')::uuid and key = 'wholesale';
insert into public.customers (id, business_id, name, phone, type) values
  ('zz-cli-dist', current_setting('t.bizA')::uuid, 'ZZ Distribuidora', '5500000000', 'distribuidor'),
  ('zz-cli-men', current_setting('t.bizA')::uuid, 'ZZ Menudeo', '5500000001', 'menudeo');

set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-00000000000a');
select public.zz_t('DB-15 dueño da de alta un producto (trigger ensure_stock_rows sin EXECUTE)',
  $q$insert into public.products (id, sku, name, category, price, sizes, colors)
     values ('zz-prod-1', 'ZZ-1', 'ZZ Blusa', 'Blusas', 500, '{S,M}', '[{"name":"Negro","hex":"#000000"}]')$q$);
select public.zz_ok('DB-15 el trigger creó las filas de stock (1 sucursal × 2 tallas)',
  (select count(*) from public.stock where product_id = 'zz-prod-1') = 2);
select public.zz_t('DB-15 dueño da de alta una sucursal (trigger ensure_branch_stock_rows sin EXECUTE)',
  $q$insert into public.branches (id, name, short) values ('zz-br-centro', 'ZZ Centro', 'Centro')$q$);
select public.zz_ok('DB-15 el trigger creó las filas de la sucursal nueva',
  (select count(*) from public.stock where product_id = 'zz-prod-1') = 4);
select public.zz_t('dueño → entrada en principal',
  $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":100},{"variantKey":"zz-prod-1|Negro|M","qty":100}]', current_setting('t.brP'), 'entrada')$q$);
select public.zz_t('dueño → entrada en centro',
  $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":10},{"variantKey":"zz-prod-1|Negro|M","qty":10}]', 'zz-br-centro', 'entrada')$q$);
select public.zz_t('dueño → ajuste', $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|M","qty":-1}]', 'zz-br-centro', 'ajuste')$q$);
select set_config('t.o1', (public.create_order(public.zz_pedido(public.zz_items(2, 0, 500)))).id, true) is not null;
select set_config('t.o2', (public.create_order(public.zz_pedido(public.zz_items(0, 1, 500)))).id, true) is not null;
select set_config('t.o4', (public.create_order(public.zz_pedido(public.zz_items(1, 0, 500)))).id, true) is not null;

\echo == DB-03 / APP-11 · vendedor: inventario y cancelación denegados
select public.zz_como('00000000-0000-4000-a000-00000000000b');
select public.zz_t('vendedor → entrada', $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":5}]', current_setting('t.brP'), 'entrada')$q$,
  'Solo el dueño o el encargado mueven inventario');
select public.zz_t('vendedor → ajuste', $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":5}]', current_setting('t.brP'), 'ajuste')$q$,
  'Solo el dueño o el encargado mueven inventario');
select public.zz_t('vendedor → conteo físico', $q$select public.set_stock_count(current_setting('t.brP'), '[{"variantKey":"zz-prod-1|Negro|S","qty":999}]')$q$,
  'Solo el dueño o el encargado mueven inventario');
select public.zz_t('vendedor → traspaso', $q$select public.transfer_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":1}]', current_setting('t.brP'), 'zz-br-centro')$q$,
  'Solo el dueño o el encargado mueven inventario');
select public.zz_t('vendedor → cancelar pedido', $q$select public.set_order_status(current_setting('t.o1'), 'cancelado')$q$,
  'Solo el dueño o el encargado cancelan pedidos');
select public.zz_t('vendedor → can_move_stock() directo (sin EXECUTE)', $q$select public.can_move_stock()$q$, 'permission denied');
select public.zz_t('vendedor → check_sale_items() directo (sin EXECUTE)',
  $q$select public.check_sale_items(current_setting('t.bizA')::uuid, '[]', null, null)$q$, 'permission denied');

\echo == DB-03 / APP-11 · encargado: permitido en cualquier sucursal
select public.zz_como('00000000-0000-4000-a000-00000000000c');
select public.zz_ok('encargado es miembro (is_member: lee productos)', (select count(*) from public.products where id = 'zz-prod-1') = 1);
select public.zz_t('encargado → entrada en centro (no es su sucursal)', $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":5}]', 'zz-br-centro', 'entrada')$q$);
select public.zz_t('encargado → ajuste en centro', $q$select public.move_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":-1}]', 'zz-br-centro', 'ajuste')$q$);
select public.zz_t('encargado → conteo físico en centro', $q$select public.set_stock_count('zz-br-centro', '[{"variantKey":"zz-prod-1|Negro|S","qty":12}]')$q$);
select public.zz_t('encargado → traspaso centro → principal', $q$select public.transfer_stock('[{"variantKey":"zz-prod-1|Negro|S","qty":2}]', 'zz-br-centro', current_setting('t.brP'))$q$);
select public.zz_ok('el conteo y el traspaso dejan centro en 10', public.zz_stock('zz-prod-1|Negro|S', 'zz-br-centro') = 10);
select set_config('t.s', public.zz_stock('zz-prod-1|Negro|S', current_setting('t.brP'))::text, true) is not null;
select public.zz_t('encargado → cancelar pedido (2 pzs S)', $q$select public.set_order_status(current_setting('t.o1'), 'cancelado')$q$);
select public.zz_ok('encargado: stock S principal +2 tras cancelar',
  public.zz_stock('zz-prod-1|Negro|S', current_setting('t.brP')) = current_setting('t.s')::int + 2);

\echo == DB-03 / DB-08 · dueño cancela; devolución agrupada por variante
select public.zz_como('00000000-0000-4000-a000-00000000000a');
select set_config('t.s', public.zz_stock('zz-prod-1|Negro|M', current_setting('t.brP'))::text, true) is not null;
select public.zz_t('dueño → cancelar pedido (1 pz M)', $q$select public.set_order_status(current_setting('t.o2'), 'cancelado')$q$);
select public.zz_ok('dueño: stock M principal +1 tras cancelar',
  public.zz_stock('zz-prod-1|Negro|M', current_setting('t.brP')) = current_setting('t.s')::int + 1);
reset role;
-- Pedido viejo con la variante repetida (2 + 3 pzs), como los que create_order aceptaba antes.
with o as (
  insert into public.orders (business_id, folio, channel, customer_name, branch, items, subtotal, total, status)
  values (current_setting('t.bizA')::uuid, 'ZZ-LEG', 'web', 'ZZ', current_setting('t.brP'),
          '[{"variantKey":"zz-prod-1|Negro|S","qty":2},{"variantKey":"zz-prod-1|Negro|S","qty":3}]', 2500, 2500, 'pagado')
  returning id)
select set_config('t.o3', id, true) is not null from o;
select set_config('t.s', public.zz_stock('zz-prod-1|Negro|S', current_setting('t.brP'))::text, true) is not null;
set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-00000000000a');
select public.zz_t('dueño → cancelar pedido con variante repetida', $q$select public.set_order_status(current_setting('t.o3'), 'cancelado')$q$);
select public.zz_ok('DB-08 la cancelación devuelve 2 + 3 = 5 pzs',
  public.zz_stock('zz-prod-1|Negro|S', current_setting('t.brP')) = current_setting('t.s')::int + 5);
select public.zz_ok('DB-08 un solo movimiento de cancelación por variante (qty 5)',
  (select array_agg(qty) from public.movements where ref = 'ZZ-LEG' and type = 'cancelacion') = '{5}');

\echo == Rol encargado en set_member
select public.zz_t('dueño boutique → set_member encargado', $q$select public.set_member('00000000-0000-4000-a000-00000000000d', 'encargado', null)$q$);
select public.zz_como('00000000-0000-4000-a000-00000000000e');
select public.zz_t('dueño restaurante → set_member encargado', $q$select public.set_member('00000000-0000-4000-a000-00000000000f', 'encargado', null)$q$,
  'Ese puesto no existe en este giro');
select public.zz_t('dueño restaurante → set_member mesero (control)', $q$select public.set_member('00000000-0000-4000-a000-00000000000f', 'mesero', null)$q$);

\echo == APP-11 · add_payment guarda solo method, amount y note
select public.zz_como('00000000-0000-4000-a000-00000000000b');
select public.zz_t('vendedor → pago con llaves de más',
  $q$select public.add_payment(current_setting('t.o4'), '{"amount":100,"method":"efectivo","note":"anticipo","id":"falso","hack":true}')$q$);
select public.zz_ok('el pago tiene solo amount, date, id, method y note (id del servidor)',
  (select array_agg(k order by k) = '{amount,date,id,method,note}' and bool_and(p ->> 'id' <> 'falso')
     from public.orders o, jsonb_array_elements(o.payments) p, jsonb_object_keys(p) k where o.id = current_setting('t.o4')));

\echo == DB-02 / DB-04 / APP-03 · cotizaciones
select set_config('t.q1', (public.save_quote(public.zz_cot(public.zz_items(2, 0, 500)))).id, true) is not null;
select public.zz_ok('save_quote recalcula: subtotal 1000, envío 100, total 1100, lista 1000, descuento 0',
  (select (subtotal, shipping, total, subtotal_list, discount) = (1000::numeric, 100::numeric, 1100::numeric, 1000::numeric, 0::numeric)
     from public.quotes where id = current_setting('t.q1')));
select public.zz_t('vendedor → UPDATE directo a quotes', $q$update public.quotes set status = 'aceptada' where id = current_setting('t.q1')$q$, 'permission denied');
select public.zz_t('vendedor → set_quote_status aceptada', $q$select public.set_quote_status(current_setting('t.q1'), 'aceptada')$q$);
select public.zz_t('vendedor → set_quote_status hacia convertida', $q$select public.set_quote_status(current_setting('t.q1'), 'convertida')$q$,
  'La cotización ya es un pedido');
select public.zz_t('vendedor → set_quote_status estado inexistente', $q$select public.set_quote_status(current_setting('t.q1'), 'perdida')$q$,
  'Estado de cotización inválido');
select public.zz_t('save_quote unitPrice NaN', $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,unitPrice}', '"NaN"')))$q$, 'Precio inválido');
select public.zz_t('save_quote unitPrice Infinity', $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,unitPrice}', '"Infinity"')))$q$, 'Precio inválido');
select public.zz_t('save_quote listPrice NaN', $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,listPrice}', '"NaN"')))$q$, 'Precio de lista inválido');
select public.zz_t('save_quote envío NaN', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), '{"shipping":"NaN"}'))$q$, 'Envío inválido');
select public.zz_t('save_quote envío negativo', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), '{"shipping":-1}'))$q$, 'Envío inválido');
select public.zz_t('save_quote depositPct 2', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), '{"depositPct":2}'))$q$, 'Anticipo inválido');
select public.zz_t('save_quote depositPct NaN', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), '{"depositPct":"NaN"}'))$q$, 'Anticipo inválido');
select public.zz_t('save_quote qty 0', $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,qty}', '0')))$q$, 'Cantidad inválida');
select public.zz_t('save_quote qty 1.5', $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,qty}', '1.5')))$q$, 'Cantidad inválida');
select public.zz_t('save_quote qty "NaN"', $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,qty}', '"NaN"')))$q$, 'Cantidad inválida');
select public.zz_t('save_quote sin renglones', $q$select public.save_quote(public.zz_cot('[]'))$q$, 'no tiene productos');
select public.zz_t('save_quote variantKey repetido', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500) || public.zz_items(2, 0, 500)))$q$, 'Producto repetido');
select public.zz_t('save_quote 201 renglones',
  $q$select public.save_quote(public.zz_cot((select jsonb_agg(jsonb_build_object('variantKey', 'zz-x-' || g, 'qty', 1, 'unitPrice', 500, 'listPrice', 500)) from generate_series(1, 201) g)))$q$,
  'hasta 200 renglones');
select public.zz_t('save_quote status convertida', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), '{"status":"convertida"}'))$q$, 'Estado de cotización inválido');
select public.zz_t('save_quote status aceptada (solo por set_quote_status)', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), '{"status":"aceptada"}'))$q$, 'Estado de cotización inválido');
select public.zz_t('vendedor → save_quote precio bajo catálogo ($450 en lista)', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 450)))$q$, 'Precio menor al de catálogo');
select public.zz_t('vendedor → save_quote mayoreo con 5 pzs', $q$select public.save_quote(public.zz_cot(public.zz_items(5, 0, 400), '{"tierId":"mayoreo"}'))$q$,
  'no alcanza las piezas mínimas');
select public.zz_t('vendedor → save_quote mayoreo con 12 pzs a $400', $q$select public.save_quote(public.zz_cot(public.zz_items(6, 6, 400), '{"tierId":"mayoreo"}'))$q$);
select public.zz_t('vendedor → save_quote producto inexistente',
  $q$select public.save_quote(public.zz_cot(jsonb_set(public.zz_items(1, 0, 500), '{0,variantKey}', '"zz-no-existe"')))$q$, 'Producto no encontrado');
select public.zz_como('00000000-0000-4000-a000-00000000000a');
select public.zz_t('dueño → UPDATE directo a quotes', $q$update public.quotes set total = 1 where id = current_setting('t.q1')$q$, 'permission denied');
select public.zz_t('dueño → save_quote precio bajo catálogo (el dueño sí puede)', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 450)))$q$);
select public.zz_t('dueño → convert_quote', $q$select public.convert_quote(current_setting('t.q1'), '{}')$q$);
select public.zz_t('set_quote_status desde convertida', $q$select public.set_quote_status(current_setting('t.q1'), 'borrador')$q$, 'La cotización ya es un pedido');
select public.zz_t('save_quote sobre una convertida', $q$select public.save_quote(public.zz_cot(public.zz_items(1, 0, 500), jsonb_build_object('id', current_setting('t.q1'))))$q$,
  'La cotización ya es un pedido');
reset role;
select public.zz_t('CHECK quotes.deposit_pct entre 0 y 1', $q$update public.quotes set deposit_pct = 2 where id = current_setting('t.q1')$q$, 'quotes_deposit_pct_valido');
select public.zz_t('CHECK quotes.total no NaN', $q$update public.quotes set total = 'NaN' where id = current_setting('t.q1')$q$, 'quotes_total_valido');
select public.zz_t('CHECK orders.total no negativo', $q$update public.orders set total = -1 where id = current_setting('t.o4')$q$, 'orders_total_valido');
select public.zz_t('CHECK orders.total no NaN', $q$update public.orders set total = 'NaN' where id = current_setting('t.o4')$q$, 'orders_total_valido');
set local role anon;
select public.zz_t('anon → set_quote_status', $q$select public.set_quote_status('x', 'aceptada')$q$, 'permission denied');
reset role;

\echo == DB-08 / DB-10 · create_order: renglones, piezas mínimas y regla de distribuidor
set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-00000000000b');
select public.zz_t('vendedor → variantKey repetido', $q$select public.create_order(public.zz_pedido(public.zz_items(1, 0, 500) || public.zz_items(1, 0, 500)))$q$,
  'Producto repetido en el pedido');
select public.zz_t('vendedor → 201 renglones',
  $q$select public.create_order(public.zz_pedido((select jsonb_agg(jsonb_build_object('variantKey', 'zz-x-' || g, 'qty', 1, 'unitPrice', 500)) from generate_series(1, 201) g)))$q$,
  'hasta 200 renglones');
select public.zz_t('vendedor → qty 0', $q$select public.create_order(public.zz_pedido(jsonb_set(public.zz_items(1, 0, 500), '{0,qty}', '0')))$q$, 'Cantidad inválida');
select public.zz_t('vendedor → unitPrice NaN', $q$select public.create_order(public.zz_pedido(jsonb_set(public.zz_items(1, 0, 500), '{0,unitPrice}', '"NaN"')))$q$, 'Precio inválido');
select public.zz_t('vendedor → mayoreo con 5 pzs', $q$select public.create_order(public.zz_pedido(public.zz_items(5, 0, 400), 'mayoreo'))$q$,
  'El pedido no alcanza las piezas mínimas de ese nivel de mayoreo');
select public.zz_t('vendedor → mayoreo con 12 pzs a $400', $q$select public.create_order(public.zz_pedido(public.zz_items(6, 6, 400), 'mayoreo'))$q$);
select public.zz_t('vendedor → mayoreo con 12 pzs a $399', $q$select public.create_order(public.zz_pedido(public.zz_items(6, 6, 399), 'mayoreo'))$q$,
  'Precio menor al de catálogo');
select public.zz_t('vendedor → nivel inexistente', $q$select public.create_order(public.zz_pedido(public.zz_items(6, 6, 400), 'vip'))$q$, 'Nivel de mayoreo inválido');
select public.zz_t('regla de distribuidor: cliente distribuidor, 24 pzs, nivel distribuidor (mín. 50) a $350',
  $q$select public.create_order(public.zz_pedido(public.zz_items(12, 12, 350), 'distribuidor', 'zz-cli-dist'))$q$);
select public.zz_t('sin regla: cliente de menudeo, 24 pzs, nivel distribuidor',
  $q$select public.create_order(public.zz_pedido(public.zz_items(12, 12, 350), 'distribuidor', 'zz-cli-men'))$q$, 'no alcanza las piezas mínimas');
select public.zz_t('sin regla: cliente distribuidor con 20 pzs (< 24)',
  $q$select public.create_order(public.zz_pedido(public.zz_items(10, 10, 350), 'distribuidor', 'zz-cli-dist'))$q$, 'no alcanza las piezas mínimas');
select public.zz_t('vendedor → save_quote con la regla de distribuidor (mismo helper)',
  $q$select public.save_quote(public.zz_cot(public.zz_items(12, 12, 350), '{"tierId":"distribuidor","customerId":"zz-cli-dist"}'))$q$);
select public.zz_como('00000000-0000-4000-a000-00000000000a');
select public.zz_t('dueño → mayoreo con 5 pzs (el dueño no tiene tope)', $q$select public.create_order(public.zz_pedido(public.zz_items(5, 0, 400), 'mayoreo'))$q$);
select public.zz_t('dueño → variantKey repetido también se rechaza', $q$select public.create_order(public.zz_pedido(public.zz_items(1, 0, 500) || public.zz_items(1, 0, 500)))$q$,
  'Producto repetido en el pedido');

\echo == DB-09 · prefijos de folio
select public.zz_t('prefijo de pedido V-1', $q$select public.update_business('ZZ Boutique', 'V-1', 'COT-')$q$, 'El prefijo debe terminar en letra o guion');
select public.zz_t('prefijo de cotización COT1', $q$select public.update_business('ZZ Boutique', 'V-', 'COT1')$q$, 'El prefijo debe terminar en letra o guion');
select public.zz_t('prefijo con espacio', $q$select public.update_business('ZZ Boutique', 'V X-', 'COT-')$q$, 'solo admiten letras, números y guion');
select public.zz_t('prefijo con símbolo', $q$select public.update_business('ZZ Boutique', 'V$', 'COT-')$q$, 'solo admiten letras, números y guion');
select public.zz_t('prefijo de 11 caracteres', $q$select public.update_business('ZZ Boutique', 'ABCDEFGHIJK', 'COT-')$q$, '10 caracteres');
select public.zz_t('prefijos válidos ZV- y Q2-A', $q$select public.update_business('ZZ Boutique', 'ZV-', 'Q2-A')$q$);

\echo == DB-06 · bitácora de platform_settings
select public.zz_como('00000000-0000-4000-a000-000000000010');
select public.zz_t('administrador → UPDATE directo de platform_settings', $q$update public.platform_settings set bank = 'ZZ Banco Prueba'$q$);
select public.zz_t('administrador → no lee la bitácora por la API', $q$select * from public.platform_settings_log$q$, 'permission denied');
select public.zz_como('00000000-0000-4000-a000-00000000000b');
select public.zz_t('vendedor → no lee la bitácora', $q$select * from public.platform_settings_log$q$, 'permission denied');
reset role;
select public.zz_ok('el UPDATE dejó fila con actor, valor anterior y nuevo',
  exists (select 1 from public.platform_settings_log
           where actor = '00000000-0000-4000-a000-000000000010' and new ->> 'bank' = 'ZZ Banco Prueba'
             and old ->> 'bank' is distinct from 'ZZ Banco Prueba'));

\echo == DB-13 · admin_mark_paid
set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-000000000010');
select public.zz_t('100 meses', $q$select public.admin_mark_paid(current_setting('t.bizA')::uuid, 100, 1199, null)$q$, 'Meses inválidos');
select public.zz_t('0 meses', $q$select public.admin_mark_paid(current_setting('t.bizA')::uuid, 0, 1199, null)$q$, 'Meses inválidos');
select public.zz_t('monto NaN', $q$select public.admin_mark_paid(current_setting('t.bizA')::uuid, 1, 'NaN', null)$q$, 'Monto inválido');
select public.zz_t('monto negativo', $q$select public.admin_mark_paid(current_setting('t.bizA')::uuid, 1, -5, null)$q$, 'Monto inválido');
select public.zz_t('nota de 501 caracteres', $q$select public.admin_mark_paid(current_setting('t.bizA')::uuid, 1, 1199, repeat('x', 501))$q$, '500 caracteres');
select public.zz_t('24 meses, monto nulo y nota de 500 (válido)', $q$select public.admin_mark_paid(current_setting('t.bizA')::uuid, 24, null, repeat('x', 500))$q$);

\echo == DB-14 · lectura del bucket logos exige membresía con acceso
reset role;
select public.zz_t('objeto de prueba en logos', $q$insert into storage.objects (bucket_id, name) values ('logos', current_setting('t.bizA') || '/zz-logo.png')$q$);
set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-00000000000b');
select public.zz_ok('vendedor con acceso ve el logo de su negocio', (select count(*) from storage.objects where bucket_id = 'logos' and name like current_setting('t.bizA') || '/%') = 1);
reset role;
update public.businesses set suspended_at = now() where id = current_setting('t.bizA')::uuid;
set local role authenticated;
select public.zz_ok('negocio suspendido: el mismo vendedor ya no lo lista', (select count(*) from storage.objects where bucket_id = 'logos' and name like current_setting('t.bizA') || '/%') = 0);
reset role;

\echo == DB-15 / DB-12 · catálogo
create function public.zz_nueva() returns int language sql as 'select 1';
select public.zz_ok('una función nueva nace sin EXECUTE para public, anon y authenticated',
  not has_function_privilege('anon', 'public.zz_nueva()', 'execute') and not has_function_privilege('authenticated', 'public.zz_nueva()', 'execute')
  and not exists (select 1 from pg_proc, aclexplode(proacl) a where proname = 'zz_nueva' and a.grantee = 0));
select public.zz_ok('handle_new_user, ensure_stock_rows y ensure_branch_stock_rows sin EXECUTE para authenticated',
  not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'public.ensure_stock_rows()', 'execute')
  and not has_function_privilege('authenticated', 'public.ensure_branch_stock_rows()', 'execute'));
select public.zz_ok('can_move_stock y check_sale_items sin EXECUTE para anon/authenticated; set_quote_status solo authenticated',
  not has_function_privilege('authenticated', 'public.can_move_stock()', 'execute')
  and not has_function_privilege('authenticated', 'public.check_sale_items(uuid, jsonb, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_quote_status(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_quote_status(text, text)', 'execute'));
select public.zz_ok('índices DB-12 en orders/movements/expenses.branch, quotes.customer_id y business_members.branch',
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in
     ('orders_branch_idx', 'movements_branch_idx', 'expenses_branch_idx', 'quotes_customer_idx', 'business_members_branch_idx')) = 5);

\echo == Resumen
select 'RESUMEN: ' || coalesce(nullif(current_setting('zz.pass', true), ''), '0') || ' PASS, '
                   || coalesce(nullif(current_setting('zz.fail', true), ''), '0') || ' FAIL';

rollback;
