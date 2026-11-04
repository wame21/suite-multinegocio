// Datos de demo para grabar el video: una boutique con 2 sucursales, catálogo, inventario, ~3 meses de ventas,
// clientes, cotizaciones de mayoreo y gastos. Pasa por las mismas RPC que la app; la llave de servicio solo
// marca la membresía como pagada y mueve fechas al pasado (las RPC sellan todo con now()). Solo corre contra el Supabase LOCAL.
// Uso: pnpm db:demo (una vez; si truena a medias borra lo que creó)
import { service, user } from "./db-helpers.mjs";

const OWNER = "demo@boutique.test";
const SELLER = "karla@boutique.test";
const DAY = 86_400_000;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// Aleatorio con semilla: cada corrida genera la misma boutique.
let seed = 20261023;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => {
  let r = rand() * pairs.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[0][0];
};

const HEX = {
  Negro: "#111111", Blanco: "#ffffff", Marfil: "#f3ead8", "Rosa palo": "#e8b4b8", Arena: "#d8c3a5",
  "Verde olivo": "#6b7a3a", Terracota: "#c0603f", "Azul marino": "#1f2a44", Rojo: "#b3262e",
  "Azul claro": "#8fb3d9", "Azul oscuro": "#2b3f63", "Azul medio": "#4f6fa0", "Gris jaspe": "#b8b8b8",
  "Champaña": "#e6d3a3", Crema: "#f1e6d2", "Café": "#6f4e37", Camel: "#b5835a", Coral: "#f08a6c", "Azul cielo": "#9cc8e8",
};
const ROPA = ["S", "M", "L", "XL"];
const PANT = ["28", "30", "32", "34", "36"];
const UNI = ["Única"];
// Piezas relativas por talla: base de las compras y de los pedidos de mayoreo.
const CURVE = { S: 2, M: 3, L: 3, XL: 1.5, 28: 1, 30: 2, 32: 2, 34: 1.5, 36: 1, "Única": 3 };

// [sku, nombre, categoría, precio, costo, tallas, colores, qué tanto se vende]
const CATALOG = [
  ["BL-101", "Blusa satinada Lía", "Blusas", 549, 210, ROPA, ["Marfil", "Negro", "Rosa palo"], 3],
  ["BL-102", "Blusa de lino Brisa", "Blusas", 499, 185, ROPA, ["Blanco", "Arena"], 2],
  ["VE-201", "Vestido midi Olivia", "Vestidos", 899, 340, ROPA, ["Verde olivo", "Negro", "Terracota"], 2.5],
  ["VE-202", "Vestido corto Amalia", "Vestidos", 749, 290, ROPA, ["Azul marino", "Rojo"], 2],
  ["JE-301", "Jean mom fit", "Jeans", 699, 260, PANT, ["Azul claro", "Azul oscuro"], 3],
  ["JE-302", "Jean wide leg", "Jeans", 799, 300, PANT, ["Azul medio", "Negro"], 2],
  ["PL-401", "Playera básica de algodón", "Playeras", 249, 85, ROPA, ["Blanco", "Negro", "Gris jaspe"], 4],
  ["FA-501", "Falda plisada Nora", "Faldas", 599, 220, ROPA, ["Champaña", "Negro"], 1.5],
  ["CH-601", "Chamarra de mezclilla", "Chamarras y suéteres", 1199, 480, ROPA, ["Azul medio"], 1],
  ["CH-602", "Suéter tejido Alba", "Chamarras y suéteres", 849, 320, ROPA, ["Crema", "Café"], 1.5],
  ["SH-701", "Short de lino", "Shorts", 449, 160, ROPA, ["Arena", "Blanco"], 1.5],
  ["AC-801", "Bolsa tote de piel", "Accesorios", 1099, 430, UNI, ["Camel", "Negro"], 1],
  ["AC-802", "Pañoleta de seda", "Accesorios", 299, 95, UNI, ["Coral", "Azul cielo"], 1.5],
];

// [nombre, negocio, teléfono, ciudad, estado, tipo, rfc]
const CUSTOMERS = [
  ["Ana Sofía Torres", null, "3310000101", "Guadalajara", "Jalisco", "menudeo"],
  ["Daniela Herrera", null, "3310000102", "Zapopan", "Jalisco", "menudeo"],
  ["Fernanda Ríos", null, "5510000103", "Ciudad de México", "CDMX", "menudeo"],
  ["Valeria Castro", null, "8110000104", "Monterrey", "Nuevo León", "menudeo"],
  ["Lucía Méndez", null, "4420000105", "Querétaro", "Querétaro", "menudeo"],
  ["Paola Jiménez", null, "3310000106", "Tlaquepaque", "Jalisco", "menudeo"],
  ["Regina Ortiz", null, "4770000107", "León", "Guanajuato", "menudeo"],
  ["Camila Navarro", null, "2220000108", "Puebla", "Puebla", "menudeo"],
  ["Rosa Elena Vargas", "Boutique Rosé", "4430000109", "Morelia", "Michoacán", "mayorista", "VARR850312AB1"],
  ["Gabriela Soto", "Moda Gaby", "4490000110", "Aguascalientes", "Aguascalientes", "mayorista", "SOGG900724CD2"],
  ["Héctor Salinas", "Distribuidora Salinas", "6670000111", "Culiacán", "Sinaloa", "distribuidor", "DSA1503109K3"],
];

const WHOLESALE = {
  enabled: true,
  tiers: [
    { id: "lista", name: "Precio de lista", minPieces: 1, discount: 0, description: "Precio de lista" },
    { id: "mayoreo", name: "Mayoreo", minPieces: 12, discount: 0.2, description: "Desde 12 piezas surtidas" },
    { id: "distribuidor", name: "Distribuidor", minPieces: 60, discount: 0.3, description: "Desde 60 piezas surtidas" },
  ],
  distributorCustomerMin: 36,
  depositPct: 0.5,
  freeShippingFrom: 10000,
  flatShipping: 350,
  validityDays: 7,
  packages: [
    {
      id: "basico-24", name: "Paquete Básico 24", pieces: 24, description: "Blusas, playeras y jeans con curva de tallas",
      mix: [{ category: "Blusas", qty: 8 }, { category: "Playeras", qty: 10 }, { category: "Jeans", qty: 6 }],
    },
  ],
  bank: { bank: "BBVA", holder: "Boutique Marea S.A. de C.V.", clabe: "012180001234567899" },
};

// Cotizaciones: [días atrás, cliente, [[sku, veces la curva de tallas]], estado, anticipo (fracción del total) o null]
const QUOTES = [
  [48, "Moda Gaby", [["JE-301", 1], ["VE-202", 1]], "convertida", 1],
  [21, "Boutique Rosé", [["BL-101", 1], ["FA-501", 0.5]], "convertida", 1],
  [2, "Distribuidora Salinas", [["PL-401", 2], ["JE-302", 1]], "enviada", null],
  [0, "Moda Gaby", [["VE-201", 1]], "borrador", null],
];

// ---------------------------------------------------------------------------
// Negocio, membresía, configuración, sucursales y equipo
// ---------------------------------------------------------------------------
const owner = await user(OWNER, { name: "Mariana López", business_name: "Boutique Marea" }).catch((e) => {
  throw new Error(`${e.message}. ¿Ya corriste el demo? Borra antes las cuentas ${OWNER} y ${SELLER}`);
});
const db = owner.db;
const biz = must(await db.from("businesses").select("*").single());
must(await service.from("businesses").update({ paid_until: iso(now + 30 * DAY) }).eq("id", biz.id));

const setting = async (key, value) =>
  must(await db.from("settings").upsert({ business_id: biz.id, key, value, updated_at: iso(now) }, { onConflict: "business_id,key" }));
await setting("profile", {
  legalName: "Boutique Marea S.A. de C.V.", phone: "3310000000", email: "", instagram: "", web: "",
  city: "Guadalajara, Jalisco", address: "Av. Juárez 120, Centro", ticketFooter: "¡Gracias por tu compra! Cambios en 15 días con ticket.",
  logoUrl: null, accentColor: null,
});
await setting("wholesale", WHOLESALE);

const [principal] = must(await db.from("branches").select("*"));
const matriz = must(await db.from("branches")
  .update({ name: "Matriz Centro", short: "Centro", address: "Av. Juárez 120, Centro, Guadalajara" })
  .eq("id", principal.id).select().single());
const andares = must(await db.from("branches")
  .insert({ name: "Plaza Andares", short: "Andares", address: "Blvd. Puerta de Hierro 4965, Zapopan", pos: true, sort: 1 })
  .select().single());

const seller = await user(SELLER, { name: "Karla Ruiz", invite_code: biz.invite_code });
must(await db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: andares.id }));

// ---------------------------------------------------------------------------
// Catálogo e inventario inicial (compra de hace 3 meses)
// ---------------------------------------------------------------------------
const opened = now - 92 * DAY;
const products = [];
for (const [sku, name, category, price, cost, sizes, colors, weight] of CATALOG) {
  const p = must(await db.from("products")
    .insert({ sku, name, brand: "Marea", category, price, sizes, colors: colors.map((c) => ({ name: c, hex: HEX[c] })) })
    .select().single());
  must(await db.from("product_costs").insert({ product_id: p.id, cost }));
  p.weight = weight;
  p.variants = colors.flatMap((c) => sizes.map((s) => ({ key: `${p.id}|${c}|${s}`, color: c, size: s })));
  products.push(p);
}
const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

// Copia local de la existencia para no vender lo que no hay.
const stock = { [matriz.id]: {}, [andares.id]: {} };
for (const [branch, factor] of [[matriz, 5], [andares, 3]]) {
  const entries = products.flatMap((p) => p.variants.map((v) => {
    // Unas cuantas variantes llegan cortas para que el inventario muestre alertas de mínimo.
    const qty = rand() < 0.06 ? 1 : Math.max(1, Math.round(CURVE[v.size] * factor * (0.8 + rand() * 0.5)));
    stock[branch.id][v.key] = qty;
    return { variantKey: v.key, qty };
  }));
  must(await db.rpc("move_stock", { p_entries: entries, p_branch: branch.id, p_type: "entrada", p_ref: "OC-0001", p_note: "Compra inicial de temporada" }));
}
must(await service.from("movements").update({ date: iso(opened) }).eq("business_id", biz.id).eq("type", "entrada"));
must(await service.from("products").update({ created_at: iso(opened) }).eq("business_id", biz.id));

const customers = must(await db.from("customers").insert(CUSTOMERS.map(([name, business, phone, city, state, type, rfc], i) => ({
  name, business, phone, city, state, type, rfc: rfc ?? null, since: iso(opened + i * 6 * DAY),
}))).select());
const retail = customers.filter((c) => c.type === "menudeo");
const byLabel = Object.fromEntries(customers.map((c) => [c.business ?? c.name, c]));

// ---------------------------------------------------------------------------
// Ventas de los últimos 90 días (más movimiento conforme se acerca hoy) y cotizaciones de mayoreo
// ---------------------------------------------------------------------------
const lineFor = (p, v, qty) => ({
  productId: p.id, variantKey: v.key, name: p.name, color: v.color, size: v.size, qty, unitPrice: p.price, unitCost: 0, listPrice: p.price,
});
const status = (order, s, shipping) => db.rpc("set_order_status", { p_order: order.id, p_status: s, p_shipping: shipping ?? null });
const tracking = () => String(Math.floor(rand() * 1e12)).padStart(12, "0");
const backdate = async (order, t) => {
  must(await service.from("orders").update({ date: iso(t), payments: order.payments.map((x) => ({ ...x, date: iso(t) })) }).eq("id", order.id));
  must(await service.from("movements").update({ date: iso(t) }).eq("business_id", biz.id).eq("ref", order.folio));
};

async function sale(t) {
  const channel = weighted([["tienda", 50], ["instagram", 18], ["whatsapp", 17], ["web", 15]]);
  const online = channel !== "tienda";
  const branch = !online && rand() < 0.45 ? andares : matriz;
  const items = [];
  for (let n = 1 + (rand() < 0.35) + (rand() < 0.12); n > 0; n--) {
    const p = weighted(products.map((x) => [x, x.weight]));
    const free = p.variants.filter((v) => stock[branch.id][v.key] > 0 && !items.some((it) => it.variantKey === v.key));
    if (!free.length) continue;
    const v = pick(free);
    const qty = stock[branch.id][v.key] > 1 && rand() < 0.15 ? 2 : 1;
    stock[branch.id][v.key] -= qty;
    items.push(lineFor(p, v, qty));
  }
  if (!items.length) return;

  const subtotal = items.reduce((a, it) => a + it.qty * it.unitPrice, 0);
  const discount = !online && rand() < 0.1 ? Math.round(subtotal * 0.1) : 0;
  const pickup = online && rand() < 0.15;
  const shipping = online && !pickup && subtotal < 1500 ? 129 : 0;
  const total = subtotal - discount + shipping;
  const customer = online || rand() < 0.3 ? pick(retail) : null;
  const method = !online
    ? weighted([["efectivo", 45], ["tarjeta", 45], ["transferencia", 10]])
    : weighted(channel === "web" ? [["mercadopago", 60], ["paypal", 15], ["tarjeta", 25]] : [["transferencia", 70], ["mercadopago", 30]]);
  const age = (now - t) / DAY;
  // En línea, lo de los últimos 2 días sigue pendiente o apartado; lo demás ya se pagó y salió.
  const half = Math.round(total / 2);
  const paid = !online ? total : age < 2 ? pick([0, half, total]) : age < 15 && rand() < 0.05 ? half : total;
  const cancel = online && age > 7 && rand() < 0.04;

  let order = must(await db.rpc("create_order", { p: {
    channel, customerId: customer?.id, customerName: customer?.name ?? "Público general", branch: branch.id, items, discount, shipping,
    payments: paid && !cancel ? [{ amount: paid, method }] : [], status: online ? undefined : "entregado", pickup,
    shippingInfo: online && !pickup ? { city: `${customer.city}, ${customer.state}` } : undefined,
    seller: branch === andares ? "Karla Ruiz" : "Mariana López",
  } }));
  if (cancel) {
    order = must(await status(order, "cancelado"));
    for (const it of items) stock[branch.id][it.variantKey] += it.qty;
  } else if (online && paid === total && age >= 2) {
    if (!pickup) order = must(await status(order, "enviado", { carrier: pick(["Estafeta", "FedEx", "DHL", "J&T"]), tracking: tracking() }));
    if (pickup || age >= 5) order = must(await status(order, "entregado"));
  }
  await backdate(order, t);
}

// Mismas reglas que /mayoreo/nueva: nivel por piezas (o cliente distribuidor), precio redondeado a $5 y envío por monto.
async function quote(t, label, picks, state, depositFrac) {
  const customer = byLabel[label];
  const items = picks.flatMap(([sku, factor]) => bySku[sku].variants
    .map((v) => lineFor(bySku[sku], v, Math.min(stock[matriz.id][v.key], Math.round(CURVE[v.size] * factor))))
    .filter((it) => it.qty > 0));
  const pieces = items.reduce((a, it) => a + it.qty, 0);
  const tier = customer.type === "distribuidor" && pieces >= WHOLESALE.distributorCustomerMin
    ? WHOLESALE.tiers.at(-1)
    : WHOLESALE.tiers.findLast((x) => pieces >= x.minPieces);
  for (const it of items) it.unitPrice = tier.discount ? Math.round((it.listPrice * (1 - tier.discount)) / 5) * 5 : it.listPrice;
  const subtotalList = items.reduce((a, it) => a + it.qty * it.listPrice, 0);
  const subtotal = items.reduce((a, it) => a + it.qty * it.unitPrice, 0);
  const shipping = subtotal >= WHOLESALE.freeShippingFrom ? 0 : WHOLESALE.flatShipping;
  const total = subtotal + shipping;

  const q = must(await db.rpc("save_quote", { p: {
    validUntil: iso(t + WHOLESALE.validityDays * DAY), customerId: customer.id, customerName: label, items, tierId: tier.id,
    subtotalList, discount: subtotalList - subtotal, subtotal, shipping, total, depositPct: WHOLESALE.depositPct,
    status: state === "borrador" ? "borrador" : "enviada",
  } }));
  // save_quote solo guarda borrador o enviada; aceptada/rechazada pasan por set_quote_status como en la app.
  const target = state === "convertida" ? "aceptada" : state;
  if (target !== "borrador" && target !== "enviada") must(await db.rpc("set_quote_status", { p_id: q.id, p_status: target }));
  must(await service.from("quotes").update({ date: iso(t) }).eq("id", q.id));
  if (state !== "convertida") return;

  for (const it of items) stock[matriz.id][it.variantKey] -= it.qty;
  const deposit = { amount: Math.round(total * depositFrac), method: "transferencia", note: depositFrac === 1 ? "Pago total" : "Anticipo" };
  let order = must(await db.rpc("convert_quote", { p_quote: q.id, p_deposit: deposit }));
  if (depositFrac === 1) {
    order = must(await status(order, "enviado", { carrier: "Paquetexpress", tracking: tracking() }));
    order = must(await status(order, "entregado"));
  }
  await backdate(order, t);
}

// Eventos en orden cronológico para que los folios crezcan con la fecha.
const events = QUOTES.map(([days, ...args]) => ({ t: now - days * DAY - 3 * 3_600_000, run: (t) => quote(t, ...args) }));
for (let i = 0; i < 320; i++) {
  let d;
  do d = rand() * 90;
  while (rand() > 1 - d / 150);
  const t = new Date(now - Math.floor(d) * DAY);
  t.setHours(10 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0);
  events.push({ t: Math.min(+t, now - 60_000 - Math.floor(rand() * 7_200_000)), run: sale });
}
events.sort((a, b) => a.t - b.t);
for (const e of events) await e.run(e.t);

// ---------------------------------------------------------------------------
// Gastos fijos de los últimos 3 meses
// ---------------------------------------------------------------------------
const expenses = [];
const today = new Date(now);
for (let m = 2; m >= 0; m--) {
  const at = (day) => new Date(today.getFullYear(), today.getMonth() - m, day, 11).getTime();
  const add = (day, category, description, amount, branch, method = "transferencia") => {
    if (at(day) <= now) expenses.push({ date: iso(at(day)), category, description, amount, branch: branch?.id ?? null, method });
  };
  add(1, "renta", "Renta local Centro", 9500, matriz);
  add(1, "renta", "Renta local Plaza Andares", 14000, andares);
  add(3, "software", "Suscripción del sistema", 499, null, "tarjeta");
  add(5, "publicidad", "Anuncios en Instagram y Facebook", 3000 + Math.round(rand() * 1500), null, "tarjeta");
  add(10, "servicios", "Luz, agua e internet", 1400 + Math.round(rand() * 400));
  add(12, "empaque", "Bolsas, papel de china y cajas", 900, null, "efectivo");
  add(15, "nomina", "Nómina 1.ª quincena", 8000);
  add(20, "envios", "Guías de paquetería", 1500 + Math.round(rand() * 800), null, "tarjeta");
  add(28, "nomina", "Nómina 2.ª quincena", 8000);
}
must(await db.from("expenses").insert(expenses));

const count = async (table) => (await db.from(table).select("*", { count: "exact", head: true })).count;
console.log(`Boutique Marea lista: ${await count("orders")} pedidos, ${await count("quotes")} cotizaciones, ${products.length} productos, ${customers.length} clientes, ${expenses.length} gastos.
Dueña:     ${OWNER} / Prueba123!
Vendedora: ${SELLER} / Prueba123! (Plaza Andares)`);
