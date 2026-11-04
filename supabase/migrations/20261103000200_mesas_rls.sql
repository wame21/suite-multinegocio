-- Mesas: solo el dueño de un negocio de giro 'restaurante' las crea, edita y borra.
-- Antes bastaba ser dueño: un dueño de boutique podía crear mesas en su negocio. La lectura (personal) no cambia.
-- No toca la FK de table_orders: una mesa con pedidos sigue sin poder borrarse, y el borrado en cascada del negocio sigue igual.

create function public.is_restaurant_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner()
    and exists (select 1 from public.businesses where id = public.current_business_id() and kind = 'restaurante'), false)
$$;
-- Las políticas se evalúan con el rol de quien consulta: necesita EXECUTE (los defaults ya no lo dan).
grant execute on function public.is_restaurant_owner() to authenticated;

drop policy "dueño gestiona mesas" on public.dining_tables;
create policy "dueño de restaurante gestiona mesas" on public.dining_tables for all to authenticated
  using (business_id = (select public.current_business_id()) and (select public.is_restaurant_owner()))
  with check (business_id = (select public.current_business_id()) and (select public.is_restaurant_owner()));
