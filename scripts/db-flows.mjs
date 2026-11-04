// Flujos de operación contra el Supabase LOCAL (pnpm exec supabase start).
// Uso: pnpm db:flows   (borra al terminar los usuarios y negocios @example.test que crea)
// Complementa a db-test.mjs: triggers de existencia, folios, ventas, pagos, cancelaciones, kardex,
// traspasos, conteos, cotizaciones, administración del negocio, logotipos y usuarios pendientes.
import { check, expectDenied, expectError, fakeIp, inviteLookup, mail, newClient, report, service as admin, signUp, user } from "./db-helpers.mjs";

const stockQty = async (db, vk, branch) =>
  (await db.from("stock").select("qty").eq("variant_key", vk).eq("branch", branch).maybeSingle()).data?.qty;
const stockCount = async (db, filters) => {
  let q = db.from("stock").select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  return (await q).count;
};
const kardex = async (db, filters) => {
  let q = db.from("movements").select("*");
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  return (await q).data ?? [];
};

const colors = [{ name: "Negro", hex: "#111111" }, { name: "Blanco", hex: "#ffffff" }];
const variantKey = (product, color, size) => `${product.id}|${color}|${size}`;
const item = (product, vk, qty, unitPrice = 599) => ({
  productId: product.id,
  variantKey: vk,
  name: product.name,
  color: vk.split("|")[1],
  size: vk.split("|")[2],
  qty,
  unitPrice,
  unitCost: 1,
  listPrice: 599,
});
const order = (product, vk, branch, qty, extra = {}) => ({
  channel: "tienda",
  customerName: "Público general",
  branch,
  items: [item(product, vk, qty)],
  payments: [],
  seller: "Karla",
  ...extra,
});

async function main() {
  // -------------------------------------------------------------------------
  // Alta de los dos negocios, el vendedor y el usuario pendiente
  // -------------------------------------------------------------------------
  const anon = newClient(fakeIp());
  const ownerA = await user(mail("flujo-dueno-a"), { name: "Dueña Alfa", business_name: "Flujos Alfa" });
  const ownerB = await user(mail("flujo-dueno-b"), { name: "Dueño Beta", business_name: "Flujos Beta" });
  const { data: bizA } = await ownerA.db.from("businesses").select("*").single();
  const { data: bizB } = await ownerB.db.from("businesses").select("*").single();
  const seller = await user(mail("flujo-karla"), { name: "Karla", invite_code: bizA.invite_code });
  const pending = await user(mail("flujo-pendiente"), { name: "Pendiente", invite_code: bizA.invite_code });
  const encargado = await user(mail("flujo-eli"), { name: "Eli", invite_code: bizA.invite_code });
  const NO_STOCK = /Solo el dueño o el encargado mueven inventario/;
  const NO_CANCEL = /Solo el dueño o el encargado cancelan pedidos/;
  const { data: [principalA] } = await ownerA.db.from("branches").select("*");
  const { data: [principalB] } = await ownerB.db.from("branches").select("*");
  check("preparación: dos negocios, un vendedor, un encargado y un pendiente", !!bizA && !!bizB && !!principalA && !!principalB && bizA.id !== bizB.id);

  // -------------------------------------------------------------------------
  // Triggers de existencia: producto con variantes y sucursal nueva
  // -------------------------------------------------------------------------
  const { data: centro } = await ownerA.db.from("branches").insert({ name: "Sucursal Centro", short: "Centro", pos: true, sort: 1 }).select().single();
  check("sucursal nueva sin productos no crea filas de existencia", (await stockCount(ownerA.db, { branch: centro.id })) === 0);

  const { error: approveErr } = await ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: centro.id });
  check("dueño aprueba al vendedor en la sucursal Centro", !approveErr, approveErr?.message);
  const { error: encApproveErr } = await ownerA.db.rpc("set_member", { p_id: encargado.id, p_role: "encargado", p_branch: centro.id });
  check("dueño aprueba al encargado en la sucursal Centro", !encApproveErr, encApproveErr?.message);

  const { data: pA, error: pAErr } = await ownerA.db
    .from("products")
    .insert({ sku: "F-001", name: "Playera flujo", brand: "Marca", category: "Playeras", price: 599, sizes: ["S", "M"], colors })
    .select()
    .single();
  check("dueño da de alta un producto con 2 colores × 2 tallas", !pAErr, pAErr?.message);
  await ownerA.db.from("product_costs").insert({ product_id: pA.id, cost: 255 });
  check("el alta crea una fila por variante y sucursal (4 × 2)", (await stockCount(ownerA.db, { product_id: pA.id })) === 8);
  const { data: allStock } = await ownerA.db.from("stock").select("qty, business_id").eq("product_id", pA.id);
  check("las filas nacen en 0 y con el negocio del producto", allStock?.every((r) => r.qty === 0 && r.business_id === bizA.id));
  check("hay filas en cada sucursal del negocio", (await stockCount(ownerA.db, { product_id: pA.id, branch: principalA.id })) === 4 && (await stockCount(ownerA.db, { product_id: pA.id, branch: centro.id })) === 4);

  const badProduct = (extra) => ownerA.db.from("products").insert({ sku: "F-BAD", name: "Variante inválida", category: "Playeras", price: 1, sizes: ["M"], colors, ...extra }).select();
  await expectError("color con «|» rechazado por el CHECK", badProduct({ colors: [{ name: "A|B", hex: "#000000" }] }), /products_variante_sin_separador/);
  await expectError("talla con «|» rechazada por el CHECK", badProduct({ sizes: ["S|M"] }), /products_variante_sin_separador/);

  const { data: pB } = await ownerB.db
    .from("products")
    .insert({ sku: "F-001", name: "Playera flujo", brand: "Marca", category: "Playeras", price: 299, sizes: ["S", "M"], colors: [colors[0]] })
    .select()
    .single();
  check("producto de B solo crea filas de sus sucursales (2 variantes × 1)", (await stockCount(ownerB.db, { product_id: pB.id })) === 2);
  await expectError("B no puede ocupar la fila de costo de un producto de A", ownerB.db.from("product_costs").insert({ product_id: pA.id, cost: 1 }));

  const { data: norte, error: norteErr } = await ownerA.db.from("branches").insert({ name: "Sucursal Norte", short: "Norte", pos: false, sort: 2 }).select().single();
  check("dueño da de alta la sucursal Norte", !norteErr, norteErr?.message);
  check("sucursal nueva abre en 0 las 4 variantes existentes", (await stockCount(ownerA.db, { branch: norte.id })) === 4);
  const { data: norteRows } = await ownerA.db.from("stock").select("qty, product_id").eq("branch", norte.id);
  check("las filas de la sucursal nueva son del producto y están en 0", norteRows?.every((r) => r.qty === 0 && r.product_id === pA.id));
  check("alta de sucursal en A no toca la existencia de B", (await stockCount(ownerB.db, { product_id: pB.id })) === 2);

  await ownerA.db.from("products").update({ sizes: ["S", "M", "L"] }).eq("id", pA.id);
  check("agregar una talla crea sus filas en todas las sucursales (6 × 3)", (await stockCount(ownerA.db, { product_id: pA.id })) === 18);
  await ownerA.db.from("products").update({ colors: [...colors, { name: "Rojo", hex: "#cc0000" }] }).eq("id", pA.id);
  check("agregar un color crea sus filas en todas las sucursales (9 × 3)", (await stockCount(ownerA.db, { product_id: pA.id })) === 27);

  const vkNM = variantKey(pA, "Negro", "M");
  const vkNS = variantKey(pA, "Negro", "S");
  const vkBS = variantKey(pA, "Blanco", "S");
  const vkNL = variantKey(pA, "Negro", "L");
  const vkB = variantKey(pB, "Negro", "M");

  // -------------------------------------------------------------------------
  // move_stock: entradas y ajustes con kardex
  // -------------------------------------------------------------------------
  const { error: in1Err } = await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: 30 }, { variantKey: vkNS, qty: 10 }, { variantKey: vkBS, qty: 10 }], p_branch: principalA.id, p_type: "entrada", p_ref: "OC-1", p_note: "Compra inicial" });
  check("dueño registra una entrada con varias variantes", !in1Err, in1Err?.message);
  check("la entrada suma a la existencia de la sucursal", (await stockQty(ownerA.db, vkNM, principalA.id)) === 30 && (await stockQty(ownerA.db, vkNS, principalA.id)) === 10);
  const [inMov] = await kardex(ownerA.db, { type: "entrada", variant_key: vkNM });
  check("el kardex anota la entrada con referencia, nota y sucursal", inMov?.qty === 30 && inMov.ref === "OC-1" && inMov.note === "Compra inicial" && inMov.branch === principalA.id && inMov.product_id === pA.id);
  await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: 5 }], p_branch: centro.id, p_type: "entrada" });
  check("la entrada en otra sucursal no mueve la principal", (await stockQty(ownerA.db, vkNM, centro.id)) === 5 && (await stockQty(ownerA.db, vkNM, principalA.id)) === 30);

  await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: variantKey(pA, "Blanco", "M"), qty: 0 }], p_branch: principalA.id, p_type: "entrada" });
  check("una entrada en 0 no deja rastro en el kardex", (await kardex(ownerA.db, { variant_key: variantKey(pA, "Blanco", "M") })).length === 0);
  await expectError("tipo de movimiento inválido", ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: 1 }], p_branch: principalA.id, p_type: "venta" }), /Tipo de movimiento inválido/);
  await expectError("variante inexistente en la sucursal", ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: `${pA.id}|Verde|M`, qty: 1 }], p_branch: principalA.id, p_type: "entrada" }), /Variante inexistente/);
  await expectError("el vendedor no registra entradas", seller.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: 5 }], p_branch: centro.id, p_type: "entrada" }), NO_STOCK);
  await expectError("el vendedor no registra ajustes", seller.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: -9 }], p_branch: centro.id, p_type: "ajuste", p_note: "Merma" }), NO_STOCK);
  check("el movimiento rechazado no toca la existencia", (await stockQty(ownerA.db, vkNM, centro.id)) === 5);
  const { error: encInErr } = await encargado.db.rpc("move_stock", { p_entries: [{ variantKey: vkNS, qty: 2 }], p_branch: principalA.id, p_type: "entrada", p_note: "Entrada del encargado" });
  check("el encargado registra una entrada en cualquier sucursal", !encInErr && (await stockQty(ownerA.db, vkNS, principalA.id)) === 12, encInErr?.message);
  await encargado.db.rpc("move_stock", { p_entries: [{ variantKey: vkNS, qty: -2 }], p_branch: principalA.id, p_type: "ajuste" });
  const { error: adjErr } = await encargado.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: -9 }], p_branch: centro.id, p_type: "ajuste", p_note: "Merma" });
  check("el encargado registra un ajuste", !adjErr, adjErr?.message);
  check("un ajuste mayor a la existencia la deja en 0", (await stockQty(ownerA.db, vkNM, centro.id)) === 0);
  const [adjMov] = await kardex(ownerA.db, { type: "ajuste", variant_key: vkNM, branch: centro.id });
  check("el kardex anota solo lo que realmente se descontó (−5)", adjMov?.qty === -5 && adjMov.note === "Merma", `qty=${adjMov?.qty}`);
  await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: 5 }], p_branch: centro.id, p_type: "entrada" });

  // -------------------------------------------------------------------------
  // create_order: folios, existencias, kardex y reglas
  // -------------------------------------------------------------------------
  let nextA = 1001;
  const folioA = () => `V-${nextA++}`;
  const { data: o1, error: o1Err } = await seller.db.rpc("create_order", {
    p: order(pA, vkNM, centro.id, 2, { discount: 50, shipping: 30, payments: [{ amount: 1178, method: "efectivo" }, { amount: 0, method: "tarjeta" }] }),
  });
  check("primer pedido del negocio = V-1001", !o1Err && o1?.folio === folioA(), o1Err?.message ?? o1?.folio);
  check("total = subtotal − descuento + envío", o1?.subtotal === 1198 && o1?.discount === 50 && o1?.shipping === 30 && o1?.total === 1178, `${o1?.subtotal}/${o1?.total}`);
  check("pago completo deja el pedido pagado y descarta pagos en 0", o1?.status === "pagado" && o1?.payments?.length === 1, `${o1?.status} ${o1?.payments?.length} pagos`);
  check("cada pago lleva id y fecha", !!o1?.payments?.[0]?.id && !!o1?.payments?.[0]?.date);
  check("el pedido descuenta la sucursal que vende", (await stockQty(ownerA.db, vkNM, centro.id)) === 3);
  check("el pedido no toca las demás sucursales", (await stockQty(ownerA.db, vkNM, principalA.id)) === 30);
  const [saleMov] = await kardex(ownerA.db, { type: "venta", ref: o1?.folio });
  check("el kardex anota la venta con folio y cantidad negativa", saleMov?.qty === -2 && saleMov.branch === centro.id && saleMov.variant_key === vkNM && saleMov.product_id === pA.id);

  const { data: o2 } = await seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1) });
  check("segundo pedido = V-1002", o2?.folio === folioA(), o2?.folio);
  check("sin pagos el pedido queda pendiente", o2?.status === "pendiente", o2?.status);

  const { data: o3, error: o3Err } = await seller.db.rpc("create_order", { p: order(pA, vkNM, principalA.id, 1, { channel: "whatsapp", payments: [{ amount: 100, method: "transferencia" }] }) });
  check("un pedido en línea del vendedor se surte de otra sucursal", !o3Err && o3?.folio === folioA(), o3Err?.message ?? o3?.folio);
  check("el anticipo parcial deja el pedido apartado", o3?.status === "apartado", o3?.status);
  check("el pedido en línea descuenta la sucursal que surte", (await stockQty(ownerA.db, vkNM, principalA.id)) === 29);

  await expectError("vendedor en mostrador solo vende en su sucursal", seller.db.rpc("create_order", { p: order(pA, vkNM, principalA.id, 1) }), /sucursal asignada/);
  await expectError("pedido sin productos", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1, { items: [] }) }), /no tiene productos/);
  await expectError("cantidad en 0", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 0) }), /Cantidad inválida/);
  await expectError("cantidad negativa", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, -1) }), /Cantidad inválida/);
  await expectError("stock insuficiente rechaza el pedido", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 99) }), /Sin existencia suficiente/);
  check("el pedido rechazado no descuenta nada", (await stockQty(ownerA.db, vkNM, centro.id)) === 2);
  await expectError("variante sin existencia en la sucursal", seller.db.rpc("create_order", { p: order(pA, vkBS, centro.id, 1) }), /Sin existencia suficiente/);
  await expectError("sucursal de otro negocio", ownerB.db.rpc("create_order", { p: order(pB, vkB, principalA.id, 1) }), /Sucursal inválida/);
  const { data: custA } = await seller.db.from("customers").insert({ name: "Cliente Mayorista", business: "Tienda Mayorista", phone: "555 000 0000", city: "Ciudad", state: "Estado", type: "distribuidor" }).select().single();
  await expectError("cliente de otro negocio", ownerB.db.rpc("create_order", { p: order(pB, vkB, principalB.id, 1, { customerId: custA.id }) }), /Cliente inválido/);
  await expectError("descuento mayor al subtotal", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1, { discount: 600 }) }), /Descuento inválido/);
  await expectError("descuento negativo", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1, { discount: -10 }) }), /Descuento inválido/);
  await expectError("envío negativo", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1, { shipping: -10 }) }), /Envío inválido/);
  await expectError("precio unitario negativo", seller.db.rpc("create_order", { p: { ...order(pA, vkNM, centro.id, 1), items: [item(pA, vkNM, 1, -599)] } }), /Precio inválido/);
  await expectError("pagos mayores al total del pedido", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1, { payments: [{ amount: 400, method: "efectivo" }, { amount: 200, method: "tarjeta" }] }) }), /Los pagos exceden el total/);
  const { data: ordersSoFar } = await ownerA.db.from("orders").select("folio");
  check("los pedidos rechazados no crean pedidos", ordersSoFar?.length === 3, `${ordersSoFar?.length} pedidos`);

  // Folios simultáneos: únicos y consecutivos
  const parallel = await Promise.all([1, 2, 3, 4].map(() => ownerA.db.rpc("create_order", { p: order(pA, vkNS, principalA.id, 1, { seller: "Dueña Alfa" }) })));
  const parallelFolios = parallel.map((r) => r.data?.folio).sort();
  const expectedFolios = [folioA(), folioA(), folioA(), folioA()];
  check("4 ventas simultáneas reciben folios únicos y consecutivos", parallel.every((r) => !r.error) && JSON.stringify(parallelFolios) === JSON.stringify(expectedFolios), parallelFolios.join(","));
  check("las ventas simultáneas descuentan una pieza cada una", (await stockQty(ownerA.db, vkNS, principalA.id)) === 6);

  // Negocio B lleva su propio contador
  await ownerB.db.rpc("move_stock", { p_entries: [{ variantKey: vkB, qty: 10 }], p_branch: principalB.id, p_type: "entrada" });
  const { data: oB1 } = await ownerB.db.rpc("create_order", { p: order(pB, vkB, principalB.id, 1, { seller: "Dueño Beta" }) });
  const { data: oB2 } = await ownerB.db.rpc("create_order", { p: order(pB, vkB, principalB.id, 1, { seller: "Dueño Beta" }) });
  check("el otro negocio empieza en su propio V-1001 y sigue con V-1002", oB1?.folio === "V-1001" && oB2?.folio === "V-1002", `${oB1?.folio} ${oB2?.folio}`);
  check("el pedido de B descuenta solo su existencia", (await stockQty(ownerB.db, vkB, principalB.id)) === 8);
  check("los pedidos de B no mueven el contador de A", (await ownerA.db.from("businesses").select("next_order_folio").single()).data?.next_order_folio === nextA);

  // -------------------------------------------------------------------------
  // add_payment y set_order_status
  // -------------------------------------------------------------------------
  await expectError("pago en 0", seller.db.rpc("add_payment", { p_order: o2.id, p_payment: { amount: 0, method: "efectivo" } }), /Monto inválido/);
  await expectError("pago negativo", seller.db.rpc("add_payment", { p_order: o2.id, p_payment: { amount: -5, method: "efectivo" } }), /Monto inválido/);
  await expectError("pago a un pedido que no existe", seller.db.rpc("add_payment", { p_order: "no-existe", p_payment: { amount: 5, method: "efectivo" } }), /Pedido no encontrado/);
  const { data: p1 } = await seller.db.rpc("add_payment", { p_order: o2.id, p_payment: { amount: 100, method: "efectivo", note: "anticipo", id: "falso", hack: true } });
  check("primer pago a un pedido pendiente lo deja apartado", p1?.status === "apartado" && p1.payments.length === 1, p1?.status);
  check("add_payment guarda solo method, amount y note (id y fecha del servidor)", JSON.stringify(Object.keys(p1?.payments?.[0] ?? {}).sort()) === JSON.stringify(["amount", "date", "id", "method", "note"]) && p1.payments[0].id !== "falso", JSON.stringify(p1?.payments?.[0]));
  const { data: p2 } = await seller.db.rpc("add_payment", { p_order: o2.id, p_payment: { amount: 499, method: "tarjeta" } });
  check("liquidar el saldo lo deja pagado", p2?.status === "pagado" && p2.payments.length === 2, `${p2?.status} ${p2?.payments?.length}`);
  await expectError("pago mayor al saldo pendiente", seller.db.rpc("add_payment", { p_order: o3.id, p_payment: { amount: 500, method: "efectivo" } }), /El pago excede el saldo pendiente/);
  check("el pago rechazado no se registra", (await ownerA.db.from("orders").select("payments").eq("id", o3.id).single()).data?.payments?.length === 1);
  const { data: p3 } = await seller.db.rpc("add_payment", { p_order: o3.id, p_payment: { amount: 499, method: "efectivo" } });
  check("un pago exacto al saldo deja el pedido pagado", p3?.status === "pagado" && p3.payments.length === 2, p3?.status);
  await expectError("un pedido pagado no admite más pagos", seller.db.rpc("add_payment", { p_order: o3.id, p_payment: { amount: 1, method: "efectivo" } }), /El pago excede el saldo pendiente/);
  check("cada pago agregado conserva el anterior y lleva id", p2?.payments?.[0]?.amount === 100 && !!p2?.payments?.[1]?.id);

  const { data: shipped, error: shipErr } = await seller.db.rpc("set_order_status", { p_order: o2.id, p_status: "enviado", p_shipping: { carrier: "Estafeta", tracking: "ABC123" } });
  check("pasar a enviado guarda los datos de envío", !shipErr && shipped?.status === "enviado" && shipped.shipping_info?.carrier === "Estafeta", shipErr?.message);
  const { data: delivered } = await seller.db.rpc("set_order_status", { p_order: o2.id, p_status: "entregado" });
  check("entregar sin datos de envío conserva los anteriores", delivered?.status === "entregado" && delivered.shipping_info?.tracking === "ABC123");
  check("cambiar de estado sin cancelar no mueve existencias", (await stockQty(ownerA.db, vkNM, centro.id)) === 2);
  await expectError("estado inválido", seller.db.rpc("set_order_status", { p_order: o2.id, p_status: "perdido" }));
  await expectError("pedido inexistente", seller.db.rpc("set_order_status", { p_order: "no-existe", p_status: "enviado" }), /Pedido no encontrado/);

  await expectError("el vendedor no cancela pedidos", seller.db.rpc("set_order_status", { p_order: o1.id, p_status: "cancelado" }), NO_CANCEL);
  check("la cancelación rechazada deja el pedido y la existencia intactos", (await ownerA.db.from("orders").select("status").eq("id", o1.id).single()).data?.status === "pagado" && (await stockQty(ownerA.db, vkNM, centro.id)) === 2);
  const { data: cancelled, error: cancelErr } = await encargado.db.rpc("set_order_status", { p_order: o1.id, p_status: "cancelado" });
  check("el encargado cancela un pedido pagado", !cancelErr && cancelled?.status === "cancelado", cancelErr?.message);
  check("cancelar regresa las piezas a la sucursal que surtió", (await stockQty(ownerA.db, vkNM, centro.id)) === 4);
  const [cancelMov] = await kardex(ownerA.db, { type: "cancelacion", ref: o1.folio });
  check("el kardex anota la cancelación con cantidad positiva", cancelMov?.qty === 2 && cancelMov.branch === centro.id && /cancelación/.test(cancelMov.note ?? ""), cancelMov?.note);
  await expectError("no se cancela dos veces", encargado.db.rpc("set_order_status", { p_order: o1.id, p_status: "cancelado" }), /ya está cancelado/);
  await expectError("un pedido cancelado no cambia de estado", seller.db.rpc("set_order_status", { p_order: o1.id, p_status: "entregado" }), /ya está cancelado/);
  await expectError("un pedido cancelado no recibe pagos", seller.db.rpc("add_payment", { p_order: o1.id, p_payment: { amount: 10, method: "efectivo" } }), /Pedido no encontrado o cancelado/);
  check("las cancelaciones repetidas no duplican las piezas", (await stockQty(ownerA.db, vkNM, centro.id)) === 4);
  const { data: o3c } = await ownerA.db.rpc("set_order_status", { p_order: o3.id, p_status: "cancelado" });
  check("el dueño cancela un pedido en línea y regresa a la sucursal que lo surtió", o3c?.status === "cancelado" && (await stockQty(ownerA.db, vkNM, principalA.id)) === 30);

  // -------------------------------------------------------------------------
  // transfer_stock y set_stock_count
  // -------------------------------------------------------------------------
  const principalBefore = await stockQty(ownerA.db, vkNM, principalA.id);
  await expectError("el vendedor no traspasa", seller.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkNM, qty: 4 }], p_from: principalA.id, p_to: norte.id }), NO_STOCK);
  check("el traspaso rechazado no mueve existencia", (await stockQty(ownerA.db, vkNM, principalA.id)) === principalBefore);
  const { error: trErr } = await encargado.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkNM, qty: 4 }, { variantKey: vkNS, qty: 0 }], p_from: principalA.id, p_to: norte.id });
  check("el encargado traspasa entre sucursales", !trErr, trErr?.message);
  check("el traspaso resta al origen y suma al destino", (await stockQty(ownerA.db, vkNM, principalA.id)) === principalBefore - 4 && (await stockQty(ownerA.db, vkNM, norte.id)) === 4);
  const trMovs = await kardex(ownerA.db, { type: "traspaso", variant_key: vkNM });
  const trOut = trMovs.find((m) => m.branch === principalA.id);
  const trIn = trMovs.find((m) => m.branch === norte.id);
  check("el kardex anota «Hacia <sucursal>» en el origen", trOut?.qty === -4 && trOut.note === `Hacia ${norte.name}`, trOut?.note);
  check("el kardex anota «Desde <sucursal>» en el destino", trIn?.qty === 4 && trIn.note === `Desde ${principalA.name}`, trIn?.note);
  check("las dos puntas del traspaso comparten referencia TR-", !!trOut?.ref && trOut.ref === trIn?.ref && trOut.ref.startsWith("TR-"), trOut?.ref);
  check("una cantidad en 0 no genera traspaso", (await kardex(ownerA.db, { type: "traspaso", variant_key: vkNS })).length === 0);
  await expectError("traspaso a la misma sucursal", encargado.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkNM, qty: 1 }], p_from: norte.id, p_to: norte.id }), /ubicaciones distintas/);
  await expectError("traspaso sin existencia suficiente", encargado.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkNM, qty: 500 }], p_from: principalA.id, p_to: norte.id }), /Sin existencia suficiente para traspasar/);
  await expectError("traspaso desde una sucursal inexistente", encargado.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkNM, qty: 1 }], p_from: "no-existe", p_to: norte.id }), /Sucursal inválida/);

  // Una variante que existe en el origen pero no en el destino (se quita la fila con la llave de servicio)
  await admin.from("stock").delete().eq("variant_key", vkNL).eq("branch", norte.id);
  await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkNL, qty: 3 }], p_branch: principalA.id, p_type: "entrada" });
  await expectError("traspaso a un destino sin la variante", encargado.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkNL, qty: 1 }], p_from: principalA.id, p_to: norte.id }), /Variante inexistente en el destino/);
  check("el traspaso fallido no descuenta el origen", (await stockQty(ownerA.db, vkNL, principalA.id)) === 3);
  await admin.from("stock").insert({ variant_key: vkNL, business_id: bizA.id, product_id: pA.id, branch: norte.id, qty: 0 });

  await expectError("el vendedor no cuenta el inventario", seller.db.rpc("set_stock_count", { p_branch: norte.id, p_entries: [{ variantKey: vkNM, qty: 10 }] }), NO_STOCK);
  const { data: changed, error: cntErr } = await encargado.db.rpc("set_stock_count", { p_branch: norte.id, p_entries: [{ variantKey: vkNM, qty: 10 }, { variantKey: vkNS, qty: 0 }] });
  check("el conteo del encargado fija la existencia y cuenta solo lo que cambió", !cntErr && changed === 1, cntErr?.message ?? `changed=${changed}`);
  check("la existencia queda en lo contado", (await stockQty(ownerA.db, vkNM, norte.id)) === 10);
  const countMovs = await kardex(ownerA.db, { type: "ajuste", branch: norte.id });
  check("el kardex anota la diferencia del conteo (+6)", countMovs.length === 1 && countMovs[0].qty === 6 && countMovs[0].note === "Conteo físico", countMovs.map((m) => `${m.qty}`).join(","));
  const { data: changedAgain } = await ownerA.db.rpc("set_stock_count", { p_branch: norte.id, p_entries: [{ variantKey: vkNM, qty: 10 }] });
  check("el dueño cuenta lo mismo: no cambia nada ni deja rastro", changedAgain === 0 && (await kardex(ownerA.db, { type: "ajuste", branch: norte.id })).length === 1);
  await expectError("el conteo no admite negativos", encargado.db.rpc("set_stock_count", { p_branch: norte.id, p_entries: [{ variantKey: vkNM, qty: -1 }] }), /no puede ser negativa/);
  await expectError("el conteo rechaza variantes inexistentes", encargado.db.rpc("set_stock_count", { p_branch: norte.id, p_entries: [{ variantKey: `${pA.id}|Verde|M`, qty: 1 }] }), /Variante inexistente/);

  // -------------------------------------------------------------------------
  // Cotizaciones: folios, edición y conversión
  // -------------------------------------------------------------------------
  // create_order lee el nivel de settings: 20 % → round(599 × 0.8 / 5) × 5 = 480, el mínimo que un vendedor puede cobrar con ese nivel
  const { data: wsA } = await ownerA.db.from("settings").select("value").eq("key", "wholesale").single();
  await ownerA.db.from("settings").update({ value: { ...wsA.value, tiers: [...wsA.value.tiers, { id: "mayoreo", name: "Mayoreo", minPieces: 6, discount: 0.2, description: "" }] } }).eq("key", "wholesale");
  const quoteOf = (customer, product, vk, qty, extra = {}) => ({
    customerId: customer.id,
    customerName: customer.business,
    items: [{ ...item(product, vk, qty), unitPrice: 480 }],
    tierId: "mayoreo",
    subtotalList: 599 * qty,
    discount: 119 * qty,
    subtotal: 480 * qty,
    shipping: 280,
    total: 480 * qty + 280,
    depositPct: 0.5,
    status: "enviada",
    validUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
    ...extra,
  });
  const { data: q1, error: q1Err } = await seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6) });
  check("primera cotización = COT-0001", !q1Err && q1?.folio === "COT-0001", q1Err?.message ?? q1?.folio);
  // 6 piezas: es el mínimo del nivel mayoreo para quien no es dueño.
  const { data: q2 } = await seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6) });
  check("segunda cotización = COT-0002", q2?.folio === "COT-0002", q2?.folio);
  const { data: q1Edit } = await seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { id: q1.id, notes: "Editada", status: "borrador" }) });
  check("editar una cotización conserva id y folio", q1Edit?.id === q1.id && q1Edit.folio === "COT-0001" && q1Edit.notes === "Editada" && q1Edit.status === "borrador", q1Edit?.folio);
  await expectDenied("la cotización no se actualiza con UPDATE directo", seller.db.from("quotes").update({ status: "aceptada" }).eq("id", q1.id).select());
  const { data: q1Acc, error: q1AccErr } = await seller.db.rpc("set_quote_status", { p_id: q1.id, p_status: "aceptada" });
  check("el estado de la cotización cambia con set_quote_status", !q1AccErr && q1Acc?.status === "aceptada" && q1Acc.folio === "COT-0001", q1AccErr?.message);
  await expectError("set_quote_status: cotización de otro negocio", ownerB.db.rpc("set_quote_status", { p_id: q1.id, p_status: "rechazada" }), /Cotización no encontrada/);
  await expectError("set_quote_status nunca va hacia convertida", seller.db.rpc("set_quote_status", { p_id: q1.id, p_status: "convertida" }), /La cotización ya es un pedido/);
  await expectError("set_quote_status rechaza un estado inexistente", seller.db.rpc("set_quote_status", { p_id: q1.id, p_status: "perdida" }), /Estado de cotización inválido/);
  await expectError("save_quote solo admite borrador o enviada", seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { id: q1.id, status: "aceptada" }) }), /Estado de cotización inválido/);
  const { data: q3 } = await seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 500) });
  check("save_quote recalcula los totales en el servidor", q3?.subtotal_list === 599 * 500 && q3.subtotal === 480 * 500 && q3.discount === 119 * 500 && q3.total === 480 * 500 + 280, `${q3?.subtotal}/${q3?.total}`);
  check("editar no gasta folio: la siguiente es COT-0003", q3?.folio === "COT-0003", q3?.folio);
  const { data: quotesA } = await ownerA.db.from("quotes").select("id");
  check("editar no duplica cotizaciones", quotesA?.length === 3, `${quotesA?.length} cotizaciones`);
  await expectError("el vendedor no cotiza debajo del piso de su nivel", seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { items: [{ ...item(pA, vkNM, 6), unitPrice: 479 }] }) }), /Precio menor al de catálogo/);
  await expectError("el vendedor no cotiza un nivel sin alcanzar sus piezas mínimas", seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 5) }), /no alcanza las piezas mínimas/);
  await expectError("save_quote rechaza renglones repetidos", seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { items: [item(pA, vkNM, 3, 480), item(pA, vkNM, 3, 480)] }) }), /Producto repetido/);
  await expectError("save_quote rechaza más de 200 renglones", ownerA.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { items: Array.from({ length: 201 }, (_, i) => item(pA, `${vkNM}${i}`, 1, 480)) }) }), /hasta 200 renglones/);
  await expectError("save_quote rechaza cantidades no enteras", ownerA.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { items: [item(pA, vkNM, 1.5, 480)] }) }), /Cantidad inválida/);
  await expectError("save_quote rechaza un anticipo fuera de 0..1", ownerA.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { depositPct: 1.5 }) }), /Anticipo inválido/);
  await expectError("save_quote rechaza un envío NaN", ownerA.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { shipping: "NaN" }) }), /Envío inválido/);
  await expectError("cotizar a un cliente de otro negocio", ownerB.db.rpc("save_quote", { p: quoteOf(custA, pB, vkB, 1) }), /Cliente inválido/);
  const { data: custB } = await ownerB.db.from("customers").insert({ name: "Cliente Beta", business: "Tienda Beta", phone: "555 111 1111", type: "mayorista" }).select().single();
  const { data: qB } = await ownerB.db.rpc("save_quote", { p: quoteOf(custB, pB, vkB, 1) });
  check("la primera cotización de B también es COT-0001", qB?.folio === "COT-0001", qB?.folio);

  // Sin sucursal que surta mayoreo
  await ownerA.db.from("branches").update({ is_warehouse: false }).eq("id", principalA.id);
  await expectError("convertir sin sucursal que surta mayoreo", seller.db.rpc("convert_quote", { p_quote: q1.id, p_deposit: {} }), /Configura qué sucursal surte el mayoreo/);
  const { data: q1Still } = await ownerA.db.from("quotes").select("status, order_id").eq("id", q1.id).single();
  check("la conversión rechazada deja la cotización intacta", q1Still?.status === "aceptada" && q1Still.order_id === null, q1Still?.status);
  await ownerA.db.from("branches").update({ is_warehouse: true }).eq("id", principalA.id);

  const beforeWarehouse = await stockQty(ownerA.db, vkNM, principalA.id);
  const { data: conv, error: convErr } = await seller.db.rpc("convert_quote", { p_quote: q1.id, p_deposit: { amount: 1547, method: "transferencia", note: "Anticipo" } });
  check("convertir crea un pedido de mayoreo ligado a la cotización", !convErr && conv?.channel === "mayoreo" && conv.quote_id === q1.id, convErr?.message);
  check("el pedido de mayoreo toma el siguiente folio del negocio", conv?.folio === folioA(), conv?.folio);
  check("el pedido sale de la sucursal is_warehouse", conv?.branch === principalA.id);
  check("el anticipo deja el pedido apartado", conv?.status === "apartado" && conv.payments.length === 1 && conv.payments[0].amount === 1547, conv?.status);
  check("el pedido de mayoreo lleva cliente, vendedor y envío de la cotización", conv?.customer_id === custA.id && conv.seller === "Karla" && conv.shipping === 280, `${conv?.seller}`);
  check("la conversión aparta las piezas de la bodega", (await stockQty(ownerA.db, vkNM, principalA.id)) === beforeWarehouse - 6);
  const [convMov] = await kardex(ownerA.db, { type: "venta", ref: conv?.folio });
  check("el kardex anota el apartado con el folio del pedido", convMov?.qty === -6 && convMov.branch === principalA.id);
  const { data: q1After } = await ownerA.db.from("quotes").select("status, order_id").eq("id", q1.id).single();
  check("la cotización queda convertida y ligada al pedido", q1After?.status === "convertida" && q1After.order_id === conv?.id);
  await expectError("una cotización convertida no se convierte otra vez", seller.db.rpc("convert_quote", { p_quote: q1.id, p_deposit: {} }), /ya es un pedido/);
  await expectError("una cotización convertida no cambia de estado", seller.db.rpc("set_quote_status", { p_id: q1.id, p_status: "borrador" }), /La cotización ya es un pedido/);

  // Cambiar la sucursal que surte mayoreo cambia de dónde se aparta
  await ownerA.db.from("branches").update({ is_warehouse: false }).eq("id", principalA.id);
  await ownerA.db.from("branches").update({ is_warehouse: true }).eq("id", norte.id);
  const { data: conv2, error: conv2Err } = await seller.db.rpc("convert_quote", { p_quote: q2.id, p_deposit: {} });
  check("sin anticipo el pedido de mayoreo queda pendiente", !conv2Err && conv2?.status === "pendiente" && conv2.payments.length === 0, conv2Err?.message ?? conv2?.status);
  check("el pedido de mayoreo siguiente toma el folio que sigue", conv2?.folio === folioA(), conv2?.folio);
  check("la nueva bodega surte el pedido", conv2?.branch === norte.id && (await stockQty(ownerA.db, vkNM, norte.id)) === 4, `branch=${conv2?.branch}`);
  await ownerA.db.from("branches").update({ is_warehouse: false }).eq("id", norte.id);
  await ownerA.db.from("branches").update({ is_warehouse: true }).eq("id", principalA.id);

  await expectError("convertir sin existencia suficiente en la bodega", seller.db.rpc("convert_quote", { p_quote: q3.id, p_deposit: {} }), /Sin existencia suficiente/);
  const { data: q3Still } = await ownerA.db.from("quotes").select("status, order_id").eq("id", q3.id).single();
  check("la conversión sin existencia deja la cotización sin convertir", q3Still?.status === "enviada" && q3Still.order_id === null, q3Still?.status);
  const { data: nextOrder } = await ownerA.db.rpc("create_order", { p: order(pA, vkNM, principalA.id, 1, { seller: "Dueña Alfa" }) });
  check("la conversión fallida no gasta folio de pedido", nextOrder?.folio === folioA(), nextOrder?.folio);

  // -------------------------------------------------------------------------
  // Administración del negocio: update_business, invitaciones y equipo
  // -------------------------------------------------------------------------
  await expectError("update_business: nombre vacío", ownerA.db.rpc("update_business", { p_name: "", p_order_prefix: "V-", p_quote_prefix: "COT-" }), /nombre del negocio es obligatorio/);
  await expectError("update_business: nombre de solo espacios", ownerA.db.rpc("update_business", { p_name: "   ", p_order_prefix: "V-", p_quote_prefix: "COT-" }), /nombre del negocio es obligatorio/);
  await expectError("update_business: prefijo de pedido vacío", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "", p_quote_prefix: "COT-" }), /vacíos/);
  await expectError("update_business: prefijo de cotización vacío", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "V-", p_quote_prefix: "" }), /vacíos/);
  await expectError("update_business: prefijo de solo espacios", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "   ", p_quote_prefix: "COT-" }), /vacíos/);
  await expectError("update_business: prefijo de pedido de más de 10 caracteres", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "ABCDEFGHIJK", p_quote_prefix: "COT-" }), /10 caracteres/);
  await expectError("update_business: prefijo de cotización de más de 10 caracteres", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "V-", p_quote_prefix: "ABCDEFGHIJK" }), /10 caracteres/);
  await expectError("update_business: prefijo de pedido que termina en dígito", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "V-1", p_quote_prefix: "COT-" }), /terminar en letra o guion/);
  await expectError("update_business: prefijo de cotización que termina en dígito", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "V-", p_quote_prefix: "COT1" }), /terminar en letra o guion/);
  await expectError("update_business: prefijo con espacio", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "V X-", p_quote_prefix: "COT-" }), /solo admiten letras, números y guion/);
  await expectError("update_business: prefijo con símbolo", ownerA.db.rpc("update_business", { p_name: "Flujos Alfa", p_order_prefix: "V$", p_quote_prefix: "COT-" }), /solo admiten letras, números y guion/);
  await expectError("update_business: el encargado no puede", encargado.db.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" }), /Solo el dueño/);
  await expectError("update_business: el vendedor no puede", seller.db.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" }), /Solo el dueño/);
  await expectError("update_business: el pendiente no puede", pending.db.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" }), /No autorizado/);
  const { data: bizUnchanged } = await ownerA.db.from("businesses").select("name, order_prefix, quote_prefix").single();
  check("los intentos rechazados no cambian el negocio", bizUnchanged?.name === "Flujos Alfa" && bizUnchanged.order_prefix === "V-" && bizUnchanged.quote_prefix === "COT-");
  const { data: tenChars, error: tenErr } = await ownerA.db.rpc("update_business", { p_name: "  Flujos Alfa  ", p_order_prefix: " ABCDEFGHIJ ", p_quote_prefix: "Q" });
  check("prefijos de exactamente 10 caracteres se aceptan y se recortan", !tenErr && tenChars?.order_prefix === "ABCDEFGHIJ" && tenChars.quote_prefix === "Q" && tenChars.name === "Flujos Alfa", tenErr?.message);
  const { data: renamed } = await ownerA.db.rpc("update_business", { p_name: "Flujos Alfa Renovada", p_order_prefix: "AL-", p_quote_prefix: "PA-" });
  check("dueño cambia nombre y prefijos", renamed?.name === "Flujos Alfa Renovada" && renamed.order_prefix === "AL-" && renamed.quote_prefix === "PA-");
  check("cambiar prefijos no toca los contadores", renamed?.next_order_folio === nextA && renamed.next_quote_folio === 4, `${renamed?.next_order_folio}/${renamed?.next_quote_folio}`);
  const { data: afterRename } = await ownerA.db.rpc("create_order", { p: order(pA, vkNM, principalA.id, 1, { seller: "Dueña Alfa" }) });
  check("el pedido siguiente usa el prefijo nuevo y sigue el contador", afterRename?.folio === `AL-${nextA}`, afterRename?.folio);
  const { data: qAfter } = await ownerA.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 1) });
  check("la cotización siguiente usa el prefijo nuevo con 4 dígitos", qAfter?.folio === "PA-0004", qAfter?.folio);
  const { data: oldOrder } = await ownerA.db.from("orders").select("folio").eq("id", o2.id).single();
  check("los pedidos anteriores conservan su folio", oldOrder?.folio === "V-1002");
  const { data: bizBUntouched } = await ownerB.db.from("businesses").select("name, order_prefix").single();
  check("el cambio en A no toca el nombre ni el prefijo de B", bizBUntouched?.name === "Flujos Beta" && bizBUntouched.order_prefix === "V-");

  // Código de invitación
  await expectError("regenerate_invite_code: el vendedor no puede", seller.db.rpc("regenerate_invite_code"), /Solo el dueño/);
  await expectError("regenerate_invite_code: el pendiente no puede", pending.db.rpc("regenerate_invite_code"), /No autorizado/);
  const oldCode = bizA.invite_code;
  const { data: newCode, error: regenErr } = await ownerA.db.rpc("regenerate_invite_code");
  check("el dueño renueva el código de invitación", !regenErr && /^[A-Z2-9]{8}$/.test(newCode ?? "") && newCode !== oldCode, regenErr?.message);
  check("el negocio guarda el código nuevo", (await ownerA.db.from("businesses").select("invite_code").single()).data?.invite_code === newCode);
  const oldLookup = await inviteLookup(anon, oldCode);
  check("el código anterior ya no resuelve", !oldLookup.error && oldLookup.data === null, oldLookup.error?.message);
  check("el código nuevo resuelve al nombre del negocio", (await inviteLookup(anon, newCode)).data === "Flujos Alfa Renovada");
  const stale = await signUp(mail("flujo-codigo-viejo"), { name: "Código viejo", invite_code: oldCode });
  check("registrarse con el código anterior se rechaza", !!stale.error, stale.error?.message);
  check("el código de B no cambia con el de A", (await ownerB.db.from("businesses").select("invite_code").single()).data?.invite_code === bizB.invite_code);

  // Equipo
  await expectError("set_member: el vendedor no puede", seller.db.rpc("set_member", { p_id: pending.id, p_role: "vendedor", p_branch: centro.id }), /Solo el dueño/);
  await expectError("set_member: el pendiente no puede", pending.db.rpc("set_member", { p_id: pending.id, p_role: "vendedor", p_branch: centro.id }), /No autorizado/);
  await expectError("set_member: sucursal de otro negocio", ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: principalB.id }), /Sucursal inválida/);
  await expectError("set_member: sucursal inexistente", ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: "no-existe" }), /Sucursal inválida/);
  await expectError("set_member: no hay un segundo dueño", ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "dueno", p_branch: null }), /Solo puede haber un dueño/);
  await expectError("set_member: el dueño no cambia su propio rol", ownerA.db.rpc("set_member", { p_id: ownerA.id, p_role: "vendedor", p_branch: null }), /propio rol/);
  await expectError("set_member: no alcanza a miembros de otro negocio", ownerB.db.rpc("set_member", { p_id: seller.id, p_role: "pendiente", p_branch: null }), /Colaborador no encontrado/);
  await expectError("set_member: el encargado no puede", encargado.db.rpc("set_member", { p_id: pending.id, p_role: "vendedor", p_branch: centro.id }), /Solo el dueño/);
  await expectError("set_member: el puesto de otro giro no existe en boutique", ownerA.db.rpc("set_member", { p_id: pending.id, p_role: "cocina", p_branch: null }), /Ese puesto no existe en este giro/);
  const { data: sellerStill } = await ownerA.db.from("business_members").select("role, branch").eq("user_id", seller.id).single();
  check("los intentos rechazados no cambian al vendedor", sellerStill?.role === "vendedor" && sellerStill.branch === centro.id);

  const { data: noBranch } = await ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: null });
  check("el dueño puede dejar al vendedor sin sucursal", noBranch?.role === "vendedor" && noBranch.branch === null);
  await expectError("un vendedor sin sucursal no vende en mostrador", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1) }), /sucursal asignada/);
  await ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "pendiente", p_branch: null });
  await expectError("al volver a pendiente el vendedor ya no vende", seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1) }), /No autorizado/);
  check("al volver a pendiente el vendedor deja de ver productos", ((await seller.db.from("products").select("id")).data ?? []).length === 0);
  const { data: restored } = await ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: centro.id });
  check("el dueño vuelve a aprobar al vendedor", restored?.role === "vendedor" && restored.branch === centro.id);
  const { error: sellsAgain } = await seller.db.rpc("create_order", { p: order(pA, vkNM, centro.id, 1) });
  check("el vendedor aprobado vuelve a vender en su sucursal", !sellsAgain, sellsAgain?.message);

  // -------------------------------------------------------------------------
  // Usuario pendiente: sin datos del negocio y sin operaciones
  // -------------------------------------------------------------------------
  const { data: pendingProfile } = await pending.db.from("profiles").select("id, active_business_id");
  const { data: pendingMem } = await pending.db.from("business_members").select("role, business_id");
  check("el pendiente solo lee su propio perfil y su membresía", pendingProfile?.length === 1 && pendingProfile[0].id === pending.id && pendingMem?.length === 1 && pendingMem[0].role === "pendiente" && pendingMem[0].business_id === bizA.id);
  for (const table of ["businesses", "branches", "products", "stock", "movements", "customers", "orders", "quotes", "expenses", "settings"]) {
    const { data: rows, error } = await pending.db.from(table).select("*");
    check(`el pendiente no lee ${table}`, !error && rows.length === 0, error?.message ?? `${rows?.length} filas`);
  }
  await expectError("el pendiente no registra clientes", pending.db.from("customers").insert({ name: "X", phone: "1" }).select().single());
  await expectDenied("el pendiente no se promueve a sí mismo", pending.db.from("business_members").update({ role: "dueno" }).eq("user_id", pending.id).select());
  check("el rol del pendiente sigue igual", (await pending.db.from("business_members").select("role").eq("user_id", pending.id).single()).data?.role === "pendiente");
  await expectDenied("el vendedor no se promueve a sí mismo", seller.db.from("business_members").update({ role: "dueno" }).eq("user_id", seller.id).select());
  await expectDenied("el encargado no se promueve a sí mismo", encargado.db.from("business_members").update({ role: "dueno" }).eq("user_id", encargado.id).select());
  await expectDenied("el pendiente no cambia su negocio activo por la tabla", pending.db.from("profiles").update({ active_business_id: bizB.id }).eq("id", pending.id).select());
  await expectError("el pendiente no entra a un negocio donde no es miembro", pending.db.rpc("set_active_business", { p_id: bizB.id }), /Negocio no encontrado/);
  check("el negocio activo del pendiente sigue igual", (await pending.db.from("profiles").select("active_business_id").eq("id", pending.id).single()).data?.active_business_id === bizA.id);
  const pendingCalls = {
    create_order: { p: order(pA, vkNM, centro.id, 1) },
    add_payment: { p_order: o2.id, p_payment: { amount: 1, method: "efectivo" } },
    set_order_status: { p_order: o2.id, p_status: "cancelado" },
    move_stock: { p_entries: [{ variantKey: vkNM, qty: 1 }], p_branch: centro.id, p_type: "ajuste" },
    transfer_stock: { p_entries: [{ variantKey: vkNM, qty: 1 }], p_from: principalA.id, p_to: norte.id },
    set_stock_count: { p_branch: centro.id, p_entries: [{ variantKey: vkNM, qty: 1 }] },
    save_quote: { p: quoteOf(custA, pA, vkNM, 1) },
    convert_quote: { p_quote: q3.id, p_deposit: {} },
    set_quote_status: { p_id: q3.id, p_status: "aceptada" },
  };
  for (const [fn, args] of Object.entries(pendingCalls)) {
    await expectError(`el pendiente no ejecuta ${fn}`, pending.db.rpc(fn, args), /No autorizado/);
  }
  await expectError("el pendiente no administra el equipo", pending.db.rpc("set_member", { p_id: pending.id, p_role: "dueno", p_branch: null }), /No autorizado/);
  check("las operaciones del pendiente no cambiaron el pedido", (await ownerA.db.from("orders").select("status").eq("id", o2.id).single()).data?.status === "entregado");

  // Una cotización convertida ya es un pedido: editarla no debe crear otra cotización ni gastar folio
  const { count: quotesBefore } = await ownerA.db.from("quotes").select("*", { count: "exact", head: true });
  await expectError("editar una cotización convertida se rechaza", seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkNM, 6, { id: q1.id, notes: "Editada tras convertir" }) }), /La cotización ya es un pedido/);
  const { count: quotesAfter } = await ownerA.db.from("quotes").select("*", { count: "exact", head: true });
  check("editar una cotización convertida no crea otra cotización", quotesAfter === quotesBefore, `${quotesBefore} → ${quotesAfter} cotizaciones`);

  // -------------------------------------------------------------------------
  // Recoge en sucursal y transiciones de estado
  // -------------------------------------------------------------------------
  await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkNM, qty: 10 }], p_branch: principalA.id, p_type: "entrada" });
  const paid = (extra = {}) => ownerA.db.rpc("create_order", { p: order(pA, vkNM, principalA.id, 1, { channel: "whatsapp", payments: [{ amount: 599, method: "efectivo" }], ...extra }) });
  const status = (o, s) => ownerA.db.rpc("set_order_status", { p_order: o.id, p_status: s });
  const regular = (await paid()).data;
  const pickup = (await paid({ pickup: true })).data;
  check("create_order guarda pickup", pickup?.pickup === true && regular?.pickup === false, `${pickup?.pickup}/${regular?.pickup}`);
  await expectError("pagado → entregado sin pickup se rechaza", status(regular, "entregado"), /No se puede cambiar el pedido de pagado a entregado/);
  check("pagado → entregado con pickup se permite", (await status(pickup, "entregado")).data?.status === "entregado");
  check("pagado → enviado sin pickup se permite", (await status(regular, "enviado")).data?.status === "enviado");
  check("enviado → entregado se permite", (await status(regular, "entregado")).data?.status === "entregado");
  await expectError("entregado → cancelado se rechaza", status(regular, "cancelado"), /No se puede cambiar el pedido de entregado a cancelado/);
  await expectError("entregado → enviado se rechaza", status(regular, "enviado"), /No se puede cambiar el pedido de entregado a enviado/);
  const pending1 = (await ownerA.db.rpc("create_order", { p: order(pA, vkNM, principalA.id, 1, { channel: "whatsapp" }) })).data;
  await expectError("pendiente → enviado se rechaza", status(pending1, "enviado"), /No se puede cambiar el pedido de pendiente a enviado/);
  const before = await stockQty(ownerA.db, vkNM, principalA.id);
  check("cancelar desde pendiente se permite y regresa las piezas", (await status(pending1, "cancelado")).data?.status === "cancelado" && (await stockQty(ownerA.db, vkNM, principalA.id)) === before + 1);
  const toCancel = (await paid()).data;
  const beforePaid = await stockQty(ownerA.db, vkNM, principalA.id);
  check("cancelar desde pagado regresa las piezas", (await status(toCancel, "cancelado")).data?.status === "cancelado" && (await stockQty(ownerA.db, vkNM, principalA.id)) === beforePaid + 1);

  // -------------------------------------------------------------------------
  // Logotipos (bucket público «logos»)
  // -------------------------------------------------------------------------
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const pngBigger = Buffer.concat([png, Buffer.alloc(64)]);
  const upload = (db, path, body = png, contentType = "image/png", upsert = false) => db.storage.from("logos").upload(path, body, { contentType, upsert });
  const logoPath = `${bizA.id}/logo.png`;
  const { error: up1Err } = await upload(ownerA.db, logoPath);
  check("dueño sube el logotipo a la carpeta de su negocio", !up1Err, up1Err?.message);
  const { data: publicUrl } = ownerA.db.storage.from("logos").getPublicUrl(logoPath);
  const res1 = await fetch(`${publicUrl.publicUrl}?v=1`);
  check("la URL pública responde con la imagen", res1.ok && res1.headers.get("content-type") === "image/png" && (await res1.arrayBuffer()).byteLength === png.length, `HTTP ${res1.status}`);
  const { error: dupErr } = await upload(ownerA.db, logoPath);
  check("subir sin upsert sobre un archivo existente se rechaza", !!dupErr, dupErr?.message ?? "no hubo error");
  const { error: up2Err } = await upload(ownerA.db, logoPath, pngBigger, "image/png", true);
  check("dueño reemplaza el logotipo (upsert)", !up2Err, up2Err?.message);
  const res2 = await fetch(`${publicUrl.publicUrl}?v=2`);
  check("la URL pública sirve el archivo reemplazado", res2.ok && (await res2.arrayBuffer()).byteLength === pngBigger.length, `HTTP ${res2.status}`);
  const { error: jpgErr } = await upload(ownerA.db, `${bizA.id}/logo.jpg`, png, "image/jpeg");
  const { error: webpErr } = await upload(ownerA.db, `${bizA.id}/logo.webp`, png, "image/webp");
  check("el bucket acepta image/jpeg e image/webp", !jpgErr && !webpErr, jpgErr?.message ?? webpErr?.message);

  await expectError("dueño de B no sube a la carpeta de A", upload(ownerB.db, `${bizA.id}/intruso.png`));
  await expectError("dueño de B no reemplaza el logotipo de A", upload(ownerB.db, logoPath, png, "image/png", true));
  await expectError("el vendedor no sube a la carpeta de su negocio", upload(seller.db, `${bizA.id}/vendedor.png`));
  await expectError("el vendedor no reemplaza el logotipo", upload(seller.db, logoPath, png, "image/png", true));
  await expectError("el encargado no sube logotipos", upload(encargado.db, `${bizA.id}/encargado.png`));
  await expectError("el pendiente no sube logotipos", upload(pending.db, `${bizA.id}/pendiente.png`));
  await expectError("un usuario sin sesión no sube logotipos", upload(anon, `${bizA.id}/anonimo.png`));
  await expectError("el dueño no sube fuera de la carpeta de su negocio", upload(ownerA.db, "logo-suelto.png"));
  await expectError("el dueño no sube a una carpeta que no es de su negocio", upload(ownerA.db, `${bizB.id}/logo.png`));
  await expectError("el bucket rechaza texto plano", upload(ownerA.db, `${bizA.id}/nota.txt`, Buffer.from("hola"), "text/plain"));
  await expectError("el bucket rechaza image/gif", upload(ownerA.db, `${bizA.id}/animado.gif`, png, "image/gif"));
  await expectError("el bucket rechaza archivos de más de 2 MB", upload(ownerA.db, `${bizA.id}/enorme.png`, Buffer.alloc(2 * 1024 * 1024 + 1), "image/png"));

  const { data: listA } = await ownerA.db.storage.from("logos").list(bizA.id);
  check("el dueño lista su carpeta", listA?.some((f) => f.name === "logo.png"), listA?.map((f) => f.name).join(","));
  const { data: listFromB } = await ownerB.db.storage.from("logos").list(bizA.id);
  check("el dueño de B no ve la carpeta de A", (listFromB ?? []).length === 0);
  await expectDenied("el vendedor no borra el logotipo", seller.db.storage.from("logos").remove([logoPath]));
  await expectDenied("el dueño de B no borra el logotipo de A", ownerB.db.storage.from("logos").remove([logoPath]));
  check("tras los intentos el logotipo sigue público", (await fetch(`${publicUrl.publicUrl}?v=3`)).ok);

  const { error: upBErr } = await upload(ownerB.db, `${bizB.id}/logo.png`);
  check("el dueño de B sube a su propia carpeta", !upBErr, upBErr?.message);
  const { data: removed, error: rmErr } = await ownerA.db.storage.from("logos").remove([logoPath, `${bizA.id}/logo.jpg`, `${bizA.id}/logo.webp`]);
  check("el dueño borra sus propios logotipos", !rmErr && removed?.length === 3, rmErr?.message ?? `${removed?.length} archivos`);
  check("el logotipo borrado deja de responder", !(await fetch(`${publicUrl.publicUrl}?v=4`)).ok);
  await ownerB.db.storage.from("logos").remove([`${bizB.id}/logo.png`]);
}

try {
  await main();
} catch (e) {
  check("el flujo terminó sin excepciones", false, e?.message ?? String(e));
}

report();
