-- Auditoría · pendientes (1/2): rol "encargado" de boutique (vende como el vendedor y además mueve inventario).
-- Va aparte: un valor nuevo de enum no se puede usar dentro de la transacción que lo agrega.
alter type public.app_role add value if not exists 'encargado';
