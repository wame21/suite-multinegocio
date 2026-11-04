-- Pruebas de supabase/migrations/20261103000200_mesas_rls.sql (CRUD de mesas). Todo dentro de BEGIN … ROLLBACK: no deja datos.
-- Uso: docker exec -i supabase_db_clotinghluiggi psql -U postgres -v ON_ERROR_STOP=0 < scripts/mesas-rls.sql
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
-- Ejecuta un update/delete y comprueba cuántas filas afectó (RLS filtra sin error).
create function public.zz_n(p_label text, p_sql text, p_expect int) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  perform public.zz_cuenta(n = p_expect);
  return case when n = p_expect then 'PASS ' else 'FAIL ' end || p_label || ' (filas: ' || n || ')';
end $$;
grant execute on function public.zz_cuenta(boolean), public.zz_t(text, text, text), public.zz_ok(text, boolean), public.zz_como(uuid),
  public.zz_n(text, text, int)
  to authenticated, anon;

\echo == Fixture
-- dueño R1 y su personal (mesero, cajero, cocina), dueño R2 (otro restaurante), dueño de boutique B
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-4000-a000-000000000a01', 'zz-dueno-r1@prueba.local', '{"name":"ZZ Dueño R1"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000a02', 'zz-mesero@prueba.local', '{"name":"ZZ Mesero"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000a03', 'zz-cajero@prueba.local', '{"name":"ZZ Cajero"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000a04', 'zz-cocina@prueba.local', '{"name":"ZZ Cocina"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000a05', 'zz-dueno-r2@prueba.local', '{"name":"ZZ Dueño R2"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000a06', 'zz-dueno-b@prueba.local', '{"name":"ZZ Dueño B"}', 'authenticated', 'authenticated');

set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-000000000a01');
select set_config('t.r1', public.create_business('ZZ Resto 1', 'restaurante')::text, true) is not null;
select public.set_active_business(current_setting('t.r1')::uuid);
select public.zz_como('00000000-0000-4000-a000-000000000a05');
select set_config('t.r2', public.create_business('ZZ Resto 2', 'restaurante')::text, true) is not null;
select public.set_active_business(current_setting('t.r2')::uuid);
select public.zz_como('00000000-0000-4000-a000-000000000a06');
select set_config('t.b', public.create_business('ZZ Boutique', 'boutique')::text, true) is not null;
select public.set_active_business(current_setting('t.b')::uuid);
reset role;

update public.businesses set approved_at = now()
 where id in (current_setting('t.r1')::uuid, current_setting('t.r2')::uuid, current_setting('t.b')::uuid);
insert into public.business_members (user_id, business_id, role, branch) values
  ('00000000-0000-4000-a000-000000000a02', current_setting('t.r1')::uuid, 'mesero', null),
  ('00000000-0000-4000-a000-000000000a03', current_setting('t.r1')::uuid, 'cajero', null),
  ('00000000-0000-4000-a000-000000000a04', current_setting('t.r1')::uuid, 'cocina', null);
update public.profiles set active_business_id = current_setting('t.r1')::uuid
 where id in ('00000000-0000-4000-a000-000000000a02', '00000000-0000-4000-a000-000000000a03', '00000000-0000-4000-a000-000000000a04');
-- Mesa de R1 con un pedido (para la FK) y mesa de R2 (para el aislamiento); se crean como superusuario.
insert into public.dining_tables (id, business_id, name, area) values
  ('00000000-0000-4000-b000-000000000001', current_setting('t.r1')::uuid, 'ZZ Con pedido', 'Salón'),
  ('00000000-0000-4000-b000-000000000002', current_setting('t.r2')::uuid, 'ZZ Ajena', 'Salón');
insert into public.table_orders (business_id, table_id, folio, customer_name, items, total, payment_method)
values (current_setting('t.r1')::uuid, '00000000-0000-4000-b000-000000000001', 'ZZ-1', 'ZZ Comensal', '[]', 0, 'efectivo');

\echo == Dueño de restaurante
set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-000000000a01');
select public.zz_t('dueño R1 → inserta mesa', $q$insert into public.dining_tables (name, area, sort) values ('ZZ Nueva', 'Terraza', 9)$q$);
select public.zz_ok('la mesa nueva quedó en su negocio con QR propio',
  (select count(*) from public.dining_tables where name = 'ZZ Nueva' and business_id = current_setting('t.r1')::uuid and length(qr_token) > 40) = 1);
select public.zz_t('dueño R1 → edita nombre, área, active y sort',
  $q$update public.dining_tables set name = 'ZZ Editada', area = 'Salón', active = false, sort = 3 where name = 'ZZ Nueva'$q$);
select public.zz_ok('la edición se guardó', (select count(*) from public.dining_tables where name = 'ZZ Editada' and not active and sort = 3) = 1);
select public.zz_t('dueño R1 → nombre repetido (23505)', $q$insert into public.dining_tables (name) values ('ZZ Editada')$q$, 'duplicate key');
select public.zz_t('dueño R1 → borra mesa sin pedidos', $q$delete from public.dining_tables where name = 'ZZ Editada'$q$);
select public.zz_ok('la mesa borrada ya no existe', (select count(*) from public.dining_tables where name = 'ZZ Editada') = 0);
select public.zz_t('dueño R1 → borra mesa con pedidos (FK 23503)', $q$delete from public.dining_tables where id = '00000000-0000-4000-b000-000000000001'$q$,
  'violates foreign key constraint');
select public.zz_ok('la mesa con pedidos sigue ahí', (select count(*) from public.dining_tables where id = '00000000-0000-4000-b000-000000000001') = 1);
select public.zz_t('dueño R1 → regenerar QR (RPC) sigue funcionando',
  $q$select public.regenerate_table_qr('00000000-0000-4000-b000-000000000001')$q$);

\echo == qr_token: nadie lo escribe directo
select public.zz_t('dueño R1 → insert con qr_token', $q$insert into public.dining_tables (name, qr_token) values ('ZZ Qr', 'x')$q$, 'permission denied');
select public.zz_t('dueño R1 → update de qr_token', $q$update public.dining_tables set qr_token = 'x' where id = '00000000-0000-4000-b000-000000000001'$q$, 'permission denied');

\echo == Mesero, cajero y cocina: leen, no escriben
select public.zz_como('00000000-0000-4000-a000-000000000a02');
select public.zz_ok('mesero lee las mesas de su negocio', (select count(*) from public.dining_tables) = 1);
select public.zz_t('mesero → insert', $q$insert into public.dining_tables (name) values ('ZZ Mesero')$q$, 'row-level security');
select public.zz_n('mesero → update no toca filas', $q$update public.dining_tables set name = 'ZZ X'$q$, 0);
select public.zz_n('mesero → delete no toca filas', $q$delete from public.dining_tables$q$, 0);
select public.zz_como('00000000-0000-4000-a000-000000000a03');
select public.zz_ok('cajero lee las mesas de su negocio', (select count(*) from public.dining_tables) = 1);
select public.zz_t('cajero → insert', $q$insert into public.dining_tables (name) values ('ZZ Cajero')$q$, 'row-level security');
select public.zz_n('cajero → update no toca filas', $q$update public.dining_tables set name = 'ZZ X'$q$, 0);
select public.zz_n('cajero → delete no toca filas', $q$delete from public.dining_tables$q$, 0);
select public.zz_como('00000000-0000-4000-a000-000000000a04');
select public.zz_ok('cocina lee las mesas de su negocio', (select count(*) from public.dining_tables) = 1);
select public.zz_t('cocina → insert', $q$insert into public.dining_tables (name) values ('ZZ Cocina')$q$, 'row-level security');
select public.zz_n('cocina → update no toca filas', $q$update public.dining_tables set name = 'ZZ X'$q$, 0);
select public.zz_n('cocina → delete no toca filas', $q$delete from public.dining_tables$q$, 0);

\echo == Otro restaurante
select public.zz_como('00000000-0000-4000-a000-000000000a05');
select public.zz_ok('dueño R2 solo ve su mesa', (select array_agg(name) from public.dining_tables) = '{"ZZ Ajena"}');
select public.zz_n('dueño R2 → update de mesa ajena no toca filas',
  $q$update public.dining_tables set name = 'ZZ Robada' where id = '00000000-0000-4000-b000-000000000001'$q$, 0);
select public.zz_n('dueño R2 → delete de mesa ajena no toca filas',
  $q$delete from public.dining_tables where id = '00000000-0000-4000-b000-000000000001'$q$, 0);
select public.zz_t('dueño R2 → insert en el negocio de R1', format($q$insert into public.dining_tables (business_id, name) values (%L, 'ZZ Intruso')$q$, current_setting('t.r1')),
  'row-level security');

\echo == Dueño de boutique
select public.zz_como('00000000-0000-4000-a000-000000000a06');
select public.zz_t('dueño de boutique → insert', $q$insert into public.dining_tables (name) values ('ZZ Boutique')$q$, 'row-level security');
select public.zz_ok('dueño de boutique no ve mesas ajenas', (select count(*) from public.dining_tables) = 0);
reset role;
-- Una mesa que ya existiera en la boutique (datos viejos): tampoco se edita ni se borra.
insert into public.dining_tables (id, business_id, name) values ('00000000-0000-4000-b000-000000000003', current_setting('t.b')::uuid, 'ZZ Vieja');
set local role authenticated;
select public.zz_como('00000000-0000-4000-a000-000000000a06');
select public.zz_n('dueño de boutique → update no toca filas', $q$update public.dining_tables set name = 'ZZ X'$q$, 0);
select public.zz_n('dueño de boutique → delete no toca filas', $q$delete from public.dining_tables$q$, 0);

\echo == anon
set local role anon;
select public.zz_t('anon → select', $q$select * from public.dining_tables$q$, 'permission denied');
select public.zz_t('anon → insert', $q$insert into public.dining_tables (name) values ('ZZ Anon')$q$, 'permission denied');
reset role;

\echo == Helper
select public.zz_ok('is_restaurant_owner: authenticated sí, anon no',
  has_function_privilege('authenticated', 'public.is_restaurant_owner()', 'execute')
  and not has_function_privilege('anon', 'public.is_restaurant_owner()', 'execute'));

\echo == Resumen
select 'RESUMEN: ' || coalesce(nullif(current_setting('zz.pass', true), ''), '0') || ' PASS, '
                   || coalesce(nullif(current_setting('zz.fail', true), ''), '0') || ' FAIL';

rollback;
