-- Suite multi-negocio · fase 1 (1/2): roles del giro Restaurante.
-- Va aparte: un valor nuevo de enum no se puede usar dentro de la transacción que lo agrega.
alter type public.app_role add value if not exists 'mesero';
alter type public.app_role add value if not exists 'cajero';
alter type public.app_role add value if not exists 'cocina';
