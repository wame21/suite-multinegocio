-- owner_overview: agrega topItems (los 3 platillos/productos más vendidos por negocio, por piezas) y separa en paymentMethods
-- la tarjeta del restaurante cobrada en la mesa o en caja (campo atTable; null en boutique y en otros métodos).
-- Solo cambia el cuerpo: firma, permisos y la regla (solo negocios propios, como dueño, con cobro al corriente) se conservan.
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
      select o.business_id, o.date as at, o.total, o.payments, o.date >= p_from as cur, o.items,
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
      select t.business_id, t.paid_at, t.total, jsonb_build_array(jsonb_build_object('method', t.payment_method, 'amount', t.total, 'atTable', t.card_at_table)),
             t.paid_at >= p_from, t.items, coalesce(c.cost, 0),
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
        select json_agg(json_build_object('businessId', business_id, 'method', method, 'atTable', at_table, 'amount', amount))
          from (select s.business_id, x ->> 'method' as method, (x ->> 'atTable')::boolean as at_table, sum((x ->> 'amount')::numeric) as amount
                  from sale s, jsonb_array_elements(s.payments) x where s.cur group by 1, 2, 3) g), '[]'::json),
      'topItems', coalesce((
        select json_agg(json_build_object('businessId', business_id, 'name', name, 'qty', qty) order by business_id, qty desc, name)
          from (select business_id, name, qty, row_number() over (partition by business_id order by qty desc, name) as rn
                  from (select s.business_id, max(i ->> 'name') as name, sum((i ->> 'qty')::numeric) as qty
                          from sale s, jsonb_array_elements(s.items) i where s.cur
                         group by s.business_id, coalesce(i ->> 'productId', i ->> 'itemId')) g) r
         where rn <= 3), '[]'::json),
      'expenseCategories', coalesce((
        select json_agg(json_build_object('businessId', business_id, 'category', category, 'amount', amount))
          from (select business_id, category, sum(amount) as amount from spend where cur group by 1, 2) g), '[]'::json),
      'bestDay', (select json_build_object('day', d, 'revenue', r)
                    from (select (at at time zone v_tz)::date as d, sum(total) as r from sale where cur group by 1 order by 2 desc limit 1) t)
    )
  );
end;
$$;
