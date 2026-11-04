# Boutique ERP

ERP en la nube para **boutiques y tiendas de ropa**. Una sola app y una sola base de Supabase atienden a muchos negocios: cada negocio tiene su equipo, sus sucursales, su catálogo y su configuración, y la seguridad por filas (RLS) impide que uno vea datos de otro.

Incluye pedidos multicanal, punto de venta, inventario por talla y sucursal, mayoreo con cotizaciones y notas imprimibles (opcional), clientes, finanzas y reportes. Nada del negocio está fijo en el código: nombre, logotipo, sucursales, categorías, tallas, canales, paqueterías, comisiones de pago y niveles de mayoreo se definen en **Configuración**.

El diseño completo (tablas, políticas, funciones y contrato con la app) está en [`docs/arquitectura-saas.md`](docs/arquitectura-saas.md).

## Montarlo

Requisitos: Node 22+, [pnpm](https://pnpm.io) y una cuenta de [Supabase](https://supabase.com).

1. **Crea un proyecto de Supabase** y copia la URL y la llave publicable (*Project Settings → API*).
2. **Aplica las migraciones:** todas las de [`supabase/migrations/`](supabase/migrations), en orden (el nombre de cada archivo empieza con su fecha).

   Con la CLI de Supabase: `pnpm exec supabase link --project-ref <ref>` y `pnpm exec supabase db push`. También puedes pegar cada archivo en el *SQL Editor*, uno por uno y en el mismo orden. El bucket de logotipos lo crea una migración; no hay que crearlo a mano.
3. **Despliega las Edge Functions** (validan el código de invitación y reciben los pedidos de mesa; son públicas, por eso van sin verificar JWT):

   ```bash
   pnpm exec supabase functions deploy invite-lookup --no-verify-jwt
   pnpm exec supabase functions deploy table-order --no-verify-jwt
   ```
4. **Variables de entorno:** copia `.env.example` a `.env.local` y llena los valores.

   | Variable | Qué es |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | llave publicable (anon) del proyecto |

5. **Autenticación:** en *Authentication → Providers → Email* deja activo el registro con correo. *Confirm email* solo debe estar apagado mientras no tengas SMTP propio (el de Supabase tiene un límite muy bajo de correos); en cuanto configures tu SMTP, actívalo.
6. **Arranca la app:**

   ```bash
   pnpm install
   pnpm dev            # http://localhost:3000
   ```

## Alta del primer negocio

1. Abre la app y ve a **Registrarme → Crear mi negocio**.
2. Escribe tu nombre, el nombre del negocio, tu correo y una contraseña.
3. Quien crea el negocio queda como **dueño**. La base siembra una sucursal principal (con punto de venta y a cargo de mayoreo y pedidos en línea) y una configuración neutra: categorías y presets de tallas comunes, canales, paqueterías y comisiones de pago. El mayoreo empieza desactivado.
4. Entra a **Configuración** y deja el negocio a tu medida.

## Invitar al equipo

1. En **Equipo** el dueño ve el **código de invitación** de su negocio (8 caracteres). Puede renovarlo cuando quiera; el anterior deja de funcionar.
2. Quien va a colaborar elige **Registrarme → Unirme a un negocio**, escribe el código y crea su cuenta. La pantalla le muestra el nombre del negocio antes de enviar.
3. La cuenta nueva queda **pendiente** y no ve datos hasta que el dueño la apruebe en **Equipo**, donde asigna rol y sucursal:
   - **Dueño:** todo su negocio, incluidos costos, utilidades, finanzas, reportes, equipo y configuración.
   - **Vendedor:** opera ventas, clientes y cotizaciones, sin ver costos ni finanzas. En el punto de venta solo cobra en su sucursal asignada.
   - **Encargado:** lo mismo que el vendedor y además mueve inventario (entradas, ajustes, conteos y traspasos) en cualquier sucursal y cancela pedidos.
   - **Pendiente:** sin acceso.

## Qué se configura en Configuración

Solo el dueño la ve; los cambios aplican a todo el equipo y cada pestaña se guarda por separado.

- **Negocio:** nombre, datos de contacto, logotipo, color de acento, pie del ticket y prefijos de folio (pedidos y cotizaciones; el contador es independiente por negocio).
- **Sucursales:** alta, edición y archivo de sucursales. Cada una puede tener punto de venta y una sola surte mayoreo y pedidos en línea.
- **Catálogo:** categorías, presets de tallas y curva de reparto de tallas para paquetes.
- **Ventas:** canales activos, paqueterías y comisión por método de pago.
- **Mayoreo:** activar el módulo, niveles de precio por piezas, anticipo, envío, vigencia, paquetes y datos de depósito.

## Módulos

| Módulo | Para qué sirve |
|---|---|
| Panel general | ventas, utilidad y margen del periodo contra el anterior; canales, tallas por agotarse y por atender |
| Pedidos | captura de pedidos de cualquier canal, pagos, estados y envío |
| Punto de venta | cobro en mostrador, ticket y corte de caja por sucursal |
| Inventario | matriz color × talla por sucursal, entradas, traspasos, ajustes, kardex y reabasto |
| Mayoreo | cotizaciones, notas y conversión en pedido apartado (solo si el negocio lo activa) |
| Clientes | directorio con historial de compras |
| Finanzas | estado de resultados, gastos, punto de equilibrio y cuentas por cobrar (dueño) |
| Reportes | rentabilidad por canal y producto, curva real de tallas (dueño) |
| Equipo | aprobación de colaboradores, roles, sucursales y código de invitación (dueño) |
| Configuración | todo lo descrito arriba (dueño) |
| Integraciones | plan por fases de conexiones con tienda en línea, mensajería y paqueterías |

## Estructura

- `supabase/migrations/`: esquema, seguridad, operaciones y almacenamiento.
- `src/lib/`: tipos (`types.ts`), store con Supabase y tiempo real (`store.ts`), configuración por negocio (`settings.ts`, `branches.ts`, `wholesale.ts`), variantes de producto (`variants.ts`), cálculos financieros (`metrics.ts`), constantes (`constants.ts`) y cliente de Supabase (`supabase/`).
- `src/app/`: una ruta por módulo (`pedidos`, `pos`, `inventario`, `mayoreo`, `clientes`, `finanzas`, `reportes`, `equipo`, `configuracion`, `integraciones`) y la pantalla de `login`.
- `src/components/`: shell de la app, marca, gráficas, documento de venta y selectores de producto y cliente.
- `src/proxy.ts`: protege las rutas y renueva la sesión de Supabase.
- `scripts/`: pruebas de la base y prueba de humo.

Stack: Next.js 16, React 19, Tailwind 4, shadcn/ui, Recharts, Zustand y Supabase.

## Pruebas

Contra un Supabase **local** (requiere Docker):

```bash
pnpm exec supabase start
pnpm exec supabase db reset    # aplica supabase/migrations
pnpm db:test                   # aislamiento entre negocios, folios, roles, membresías y logotipos (borra lo que crea)
```

Prueba de humo en Chromium (con `pnpm dev` corriendo y `.env.local` apuntando a un Supabase de pruebas; da de alta un negocio nuevo y recorre las rutas; usa `/usr/bin/chromium`, cambia la ruta con `CHROMIUM=`):

```bash
pnpm smoke                     # capturas en ./.smoke
```

## Datos de demo

Boutique ficticia para grabar demos: 2 sucursales, 13 productos, ~320 pedidos de los últimos 3 meses, clientes, cotizaciones de mayoreo y gastos. Solo corre contra el Supabase **local** y no se puede repetir sin `db reset`:

```bash
pnpm exec supabase db reset && pnpm db:demo
```

Entra con `demo@boutique.test` / `Prueba123!` (dueña) o `karla@boutique.test` / `Prueba123!` (vendedora de Plaza Andares). La app debe apuntar al Supabase local: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` y la `PUBLISHABLE_KEY` que muestra `pnpm exec supabase status`.
