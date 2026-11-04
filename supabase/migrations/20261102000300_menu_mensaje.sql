-- Mensaje de bienvenida del menú público: settings.restaurant.welcome (hasta 200 caracteres) sale en table_menu.business.welcome.
-- Solo cambia el cuerpo de table_menu; firma y permisos (anon) se conservan.
create or replace function public.table_menu(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business', json_build_object('name', b.name, 'logoUrl', pr.value ->> 'logoUrl', 'accentColor', pr.value ->> 'accentColor',
                                  'welcome', nullif(left(cf.value ->> 'welcome', 200), '')),
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
