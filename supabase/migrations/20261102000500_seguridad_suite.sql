-- Seguridad de la suite antes de publicarla (auditoría S1, .audit/04-suite-bd.md).
-- · new_token() y valid_modifiers() nacieron ejecutables por PUBLIC (anon incluido): solo las usan el DEFAULT y el CHECK de
--   tablas que escribe un usuario con sesión.
-- · anon no necesita ningún permiso de tabla (solo entra por RPC): se quitan los heredados por defecto; el RLS ya los negaba.
-- · create_business: a lo más 3 negocios en revisión por cuenta (antes solo el tope de 10 en total).
-- · my_businesses: el motivo del rechazo solo lo ve el dueño, no el personal ni los pendientes.
-- · Fotos y logotipo: solo URLs https:// (o http://localhost / 127.0.0.1 del Supabase local); sin javascript:, data: ni http público.
--   El color de acento solo #rrggbb: lo ve el comensal sin sesión y la interfaz lo usa como estilo.
-- Solo cambian cuerpos, permisos y restricciones; las firmas no.

revoke execute on function public.new_token(), public.valid_modifiers(jsonb) from public, anon;
grant execute on function public.new_token(), public.valid_modifiers(jsonb) to authenticated, service_role;

-- Se valida la restricción ya: si hubiera datos viejos que no la cumplan, la migración falla en vez de dejarlos pasar.
alter table public.menu_items add constraint menu_items_photo_url
  check (photo is null or photo ~ '^(https://|http://(127\.0\.0\.1|localhost)([:/]))\S+$');
alter table public.settings add constraint settings_profile_logo_color
  check (key <> 'profile' or (
    coalesce(value ->> 'logoUrl', '') ~ '^((https://|http://(127\.0\.0\.1|localhost)([:/]))\S+)?$'
    and coalesce(value ->> 'accentColor', '') ~ '^(#[0-9a-fA-F]{6})?$'));

revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- create_business (versión de 20261102000200_restaurante.sql + tope de negocios en revisión)
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
  -- El candado por cuenta evita pasar los topes con llamadas en paralelo.
  perform pg_advisory_xact_lock(hashtext('create_business:' || auth.uid()::text));
  -- Tope contra abuso: sin él, una sola cuenta podría llenar la base de negocios.
  if (select count(*) from public.business_members where user_id = auth.uid() and role = 'dueno') >= 10 then
    raise exception 'Llegaste al máximo de negocios por cuenta';
  end if;
  -- Bandeja de /admin: a lo más 3 negocios en revisión por cuenta.
  if (select count(*) from public.business_members m join public.businesses b on b.id = m.business_id
        cross join lateral public.membership(b) s
       where m.user_id = auth.uid() and m.role = 'dueno' and s.state = 'revision') >= 3 then
    raise exception 'Ya tienes 3 negocios en revisión: espera a que se aprueben antes de crear otro';
  end if;

  insert into public.businesses (name, kind) values (v_name, p_kind) returning id into v_id;
  perform public.seed_business_defaults(v_id);
  insert into public.business_members (user_id, business_id, role, branch)
  values (auth.uid(), v_id, 'dueno', (select id from public.branches where business_id = v_id and is_warehouse));

  -- Solo los datos de contacto y el color del formulario "Datos del negocio", cortos y como texto.
  update public.settings
     set value = value || (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_profile) e (k, v)
                            where k in ('legalName', 'phone', 'email', 'instagram', 'web', 'city', 'address', 'accentColor')
                              and jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 200
                              and (k <> 'accentColor' or v #>> '{}' ~ '^#[0-9a-fA-F]{6}$'))
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
-- my_businesses (versión de 20261102000200_restaurante.sql; el motivo del rechazo solo para el dueño)
-- ---------------------------------------------------------------------------
create or replace function public.my_businesses() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
      'id', b.id, 'name', b.name, 'kind', b.kind, 'role', m.role, 'state', s.state, 'endsAt', s.ends_at,
      'rejectionReason', case when s.state = 'rechazada' and m.role = 'dueno' then b.suspended_reason end,
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
