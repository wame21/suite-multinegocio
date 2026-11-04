// Pruebas de la base de datos contra el Supabase LOCAL (pnpm exec supabase start).
// Uso: pnpm db:test   (borra al terminar los usuarios y negocios @example.test que crea)
// Crea dos negocios y verifica el aislamiento entre ellos, los folios por negocio, las membresías y las reglas de rol.
import { check, createBusiness, expectDenied, expectError, fakeIp, inviteLookup, mail, newClient, platformAdmin, report, service, signIn, signUp, user } from "./db-helpers.mjs";

// ---------------------------------------------------------------------------
// Alta de negocios y usuarios
// ---------------------------------------------------------------------------
const anon = newClient(fakeIp());
const { data: unknownCode } = await inviteLookup(anon, "ZZZZZZZZ");
check("invite-lookup de un código inexistente = null", unknownCode === null);
await expectError("anon ya no consulta códigos directo en la base", anon.rpc("invite_lookup", { p_code: "ZZZZZZZZ", p_key: "x" }));
const { error: legacyErr } = await anon.rpc("owner_exists");
check("owner_exists ya no existe", !!legacyErr);

// Sin código el alta solo crea el perfil: el negocio se crea después con create_business.
const noMeta = await signUp(mail("sin-datos"), { name: "Sin datos" });
check("alta sin negocio ni código solo crea el perfil", !noMeta.error && !!noMeta.id, noMeta.error?.message);
await signIn(noMeta.client, mail("sin-datos"));
const { data: noMetaProfile } = await noMeta.client.from("profiles").select("active_business_id").eq("id", noMeta.id).single();
check("ese perfil no tiene negocio activo ni membresías", noMetaProfile?.active_business_id === null && (await noMeta.client.from("business_members").select("business_id")).data?.length === 0);
check("my_businesses de un perfil nuevo viene vacío", ((await noMeta.client.rpc("my_businesses")).data ?? []).length === 0);
await expectError("sin negocio activo no se vende", noMeta.client.rpc("create_order", { p: {} }), /No autorizado/);
await expectError("create_business exige nombre", noMeta.client.rpc("create_business", { p_name: "  ", p_kind: "boutique" }), /Nombre inválido/);
await expectError("create_business rechaza un giro desconocido", noMeta.client.rpc("create_business", { p_name: "X", p_kind: "taller" }), /Giro inválido/);
await expectError("anon no crea negocios", anon.rpc("create_business", { p_name: "X", p_kind: "boutique" }), /permission denied/);
await expectError("set_active_business rechaza un negocio ajeno", noMeta.client.rpc("set_active_business", { p_id: "00000000-0000-0000-0000-000000000000" }), /Negocio no encontrado/);
const badCode = await signUp(mail("mal-codigo"), { name: "Mal código", invite_code: "ZZZZZZZZ" });
check("alta con código inválido se rechaza", !!badCode.error, badCode.error?.message);

const ownerA = await user(mail("dueno-a"), { name: "Dueña Alfa", business_name: "Boutique Alfa" });
const ownerB = await user(mail("dueno-b"), { name: "Dueño Beta", business_name: "Boutique Beta" });

const { data: bizA } = await ownerA.db.from("businesses").select("*").single();
const { data: bizB } = await ownerB.db.from("businesses").select("*").single();
check("alta por business_name crea el negocio", bizA?.name === "Boutique Alfa" && bizB?.name === "Boutique Beta");
check("cada negocio es distinto", !!bizA && !!bizB && bizA.id !== bizB.id);
check("folios iniciales por defecto", bizA?.order_prefix === "V-" && bizA?.next_order_folio === 1001 && bizA?.quote_prefix === "COT-" && bizA?.next_quote_folio === 1);
check("código de invitación de 8 caracteres [A-Z2-9]", /^[A-Z2-9]{8}$/.test(bizA?.invite_code ?? "") && /^[A-Z2-9]{8}$/.test(bizB?.invite_code ?? ""));
check("códigos de invitación distintos", bizA?.invite_code !== bizB?.invite_code);

const { data: memA } = await ownerA.db.from("business_members").select("*").eq("user_id", ownerA.id).single();
const { data: profA } = await ownerA.db.from("profiles").select("*").eq("id", ownerA.id).single();
check("quien crea el negocio es dueño y su negocio activo", memA?.role === "dueno" && memA?.business_id === bizA.id && profA?.active_business_id === bizA.id);
check("profiles ya no guarda rol, negocio ni sucursal", !("role" in profA) && !("business_id" in profA) && !("branch" in profA));
const { data: listA } = await ownerA.db.rpc("my_businesses");
check("my_businesses lista el negocio activo con el giro y el rol", listA?.length === 1 && listA[0].id === bizA.id && listA[0].kind === "boutique" && listA[0].role === "dueno" && listA[0].active === true, JSON.stringify(listA));

const { data: branchesA } = await ownerA.db.from("branches").select("*");
check("negocio nuevo trae una sucursal principal", branchesA?.length === 1 && branchesA[0].pos && branchesA[0].is_warehouse, `${branchesA?.length} sucursales`);
check("el dueño queda asignado a la sucursal principal", memA?.branch === branchesA?.[0]?.id);
const principalA = branchesA[0];
const { data: branchesB } = await ownerB.db.from("branches").select("*");
const principalB = branchesB[0];
const { data: cfgA } = await ownerA.db.from("settings").select("key, value");
check("configuración inicial: profile, catalog, sales, wholesale", ["profile", "catalog", "sales", "wholesale"].every((k) => cfgA?.some((r) => r.key === k)), cfgA?.map((r) => r.key).join(","));
check("mayoreo viene activo", cfgA?.find((r) => r.key === "wholesale")?.value?.enabled === true);

const { data: lookup } = await inviteLookup(anon, bizA.invite_code.toLowerCase());
check("invite-lookup devuelve el nombre sin distinguir mayúsculas", lookup === "Boutique Alfa", String(lookup));

// El vendedor entra con el código en minúsculas; el pendiente con el código tal cual.
const seller = await user(mail("karla"), { name: "Karla", invite_code: bizA.invite_code.toLowerCase() });
const pending = await user(mail("pendiente"), { name: "Pendiente", invite_code: bizA.invite_code });
const encargado = await user(mail("eli"), { name: "Eli", invite_code: bizA.invite_code });
const { data: sellerMem } = await seller.db.from("business_members").select("*").eq("user_id", seller.id).single();
const { data: sellerProfile } = await seller.db.from("profiles").select("active_business_id").eq("id", seller.id).single();
check("alta por invite_code queda pendiente en ese negocio", sellerMem?.role === "pendiente" && sellerMem?.business_id === bizA.id && sellerProfile?.active_business_id === bizA.id);

// ---------------------------------------------------------------------------
// Pendiente: sin acceso hasta que el dueño apruebe
// ---------------------------------------------------------------------------
const { data: pendingProducts } = await seller.db.from("products").select("id");
check("pendiente no ve productos", Array.isArray(pendingProducts) && pendingProducts.length === 0);
const { data: pendingBiz } = await pending.db.from("businesses").select("id");
check("pendiente no lee el negocio", Array.isArray(pendingBiz) && pendingBiz.length === 0);
const { data: pendingCfg } = await pending.db.from("settings").select("key");
check("pendiente no lee la configuración", Array.isArray(pendingCfg) && pendingCfg.length === 0);
await expectError("pendiente no puede vender", seller.db.rpc("create_order", { p: {} }), /No autorizado/);
await expectDenied("pendiente no cambia su membresía", seller.db.from("business_members").update({ role: "dueno" }).eq("user_id", seller.id).select());
await expectDenied("pendiente no se pasa a otro negocio activo por la tabla", pending.db.from("profiles").update({ active_business_id: bizB.id }).eq("id", pending.id).select());

// ---------------------------------------------------------------------------
// Equipo y sucursales (negocio A)
// ---------------------------------------------------------------------------
const { data: centro, error: centroErr } = await ownerA.db
  .from("branches")
  .insert({ name: "Sucursal Centro", short: "Centro", pos: true, sort: 1 })
  .select()
  .single();
check("dueño da de alta una sucursal", !centroErr && !!centro?.id, centroErr?.message);
await expectDenied("vendedor no da de alta sucursales", seller.db.from("branches").insert({ name: "Intrusa", short: "X" }).select());
await expectError("solo una sucursal surte mayoreo por negocio", ownerA.db.from("branches").update({ is_warehouse: true }).eq("id", centro.id).select());

await expectError("vendedor no puede autoasignarse", seller.db.rpc("set_member", { p_id: seller.id, p_role: "dueno", p_branch: centro.id }));
await expectError("el dueño no cambia su propio rol", ownerA.db.rpc("set_member", { p_id: ownerA.id, p_role: "vendedor", p_branch: null }), /propio rol/);
await expectError("no se puede nombrar a otro dueño", ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "dueno", p_branch: null }), /Solo puede haber un dueño/);
await expectError("set_member rechaza una sucursal de otro negocio", ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: principalB.id }), /Sucursal inválida/);
const { error: approveErr } = await ownerA.db.rpc("set_member", { p_id: seller.id, p_role: "vendedor", p_branch: centro.id });
check("dueño aprueba vendedor en una sucursal", !approveErr, approveErr?.message);
const { data: sellerAfter } = await seller.db.from("business_members").select("*").eq("user_id", seller.id).single();
check("el vendedor queda con su rol y sucursal", sellerAfter?.role === "vendedor" && sellerAfter?.branch === centro.id);
await expectError("el vendedor no se asciende por la tabla de membresías", seller.db.from("business_members").update({ role: "dueno" }).eq("user_id", seller.id).select());
await expectError("encargado: el vendedor no asigna puestos", seller.db.rpc("set_member", { p_id: encargado.id, p_role: "encargado", p_branch: null }), /Solo el dueño/);
await expectError("un puesto de restaurante no existe en boutique", ownerA.db.rpc("set_member", { p_id: encargado.id, p_role: "mesero", p_branch: null }), /Ese puesto no existe en este giro/);
const { data: encMem, error: encErr } = await ownerA.db.rpc("set_member", { p_id: encargado.id, p_role: "encargado", p_branch: centro.id });
check("dueño asigna el puesto de encargado en boutique", !encErr && encMem?.role === "encargado" && encMem.branch === centro.id, encErr?.message);

// ---------------------------------------------------------------------------
// Catálogo e inventario (negocio A)
// ---------------------------------------------------------------------------
const colors = [{ name: "Negro", hex: "#111111" }];
const { data: pA, error: pAErr } = await ownerA.db
  .from("products")
  .insert({ sku: "T-001", name: "Polo prueba", brand: "Marca", category: "Polos", price: 599, sizes: ["S", "M"], colors, woo_id: 1 })
  .select()
  .single();
check("dueño da de alta producto", !pAErr, pAErr?.message);
await ownerA.db.from("product_costs").insert({ product_id: pA.id, cost: 255 });
const stockRows = async (db, product) => (await db.from("stock").select("*", { count: "exact", head: true }).eq("product_id", product)).count;
check("trigger crea 2 tallas × 2 sucursales", (await stockRows(ownerA.db, pA.id)) === 4);
const { data: bodega, error: bodegaErr } = await ownerA.db.from("branches").insert({ name: "Sucursal Norte", short: "Norte", pos: false, sort: 2 }).select().single();
check("sucursal nueva se crea sin punto de venta", !bodegaErr && bodega?.pos === false, bodegaErr?.message);
check("sucursal nueva abre existencia en 0 de los productos existentes", (await stockRows(ownerA.db, pA.id)) === 6);
await expectError("woo_id es único dentro del negocio", ownerA.db.from("products").insert({ sku: "T-002", name: "Repetido", category: "Polos", price: 1, sizes: ["M"], colors, woo_id: 1 }).select().single());
await expectError("vendedor no puede dar de alta productos", seller.db.from("products").insert({ sku: "X", name: "X", category: "Polos", price: 1, sizes: ["M"] }).select().single());
await expectDenied("vendedor no puede cambiar precios", seller.db.from("products").update({ price: 1 }).eq("id", pA.id).select());

const vkA = `${pA.id}|Negro|M`;
const NO_STOCK = /Solo el dueño o el encargado mueven inventario/;
await expectError("vendedor no registra entradas", seller.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 5 }], p_branch: centro.id, p_type: "entrada" }), NO_STOCK);
await expectError("vendedor no registra ajustes", seller.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: -1 }], p_branch: centro.id, p_type: "ajuste" }), NO_STOCK);
const { error: encInErr } = await encargado.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 1 }], p_branch: centro.id, p_type: "entrada", p_ref: "OC-0" });
check("encargado registra entradas", !encInErr, encInErr?.message);
const { error: encOutErr } = await encargado.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: -1 }], p_branch: centro.id, p_type: "ajuste" });
check("encargado registra ajustes", !encOutErr, encOutErr?.message);
const { error: inErr } = await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 3 }], p_branch: centro.id, p_type: "entrada", p_ref: "OC-1" });
check("dueño registra entrada", !inErr, inErr?.message);

const item = (product, vk, qty) => ({ productId: product.id, variantKey: vk, name: product.name, color: "Negro", size: "M", qty, unitPrice: 599, unitCost: 1, listPrice: 599 });
const order = (product, vk, branch, qty, extra = {}) => ({
  channel: "tienda",
  customerName: "Público general",
  branch,
  items: [item(product, vk, qty)],
  payments: [{ amount: 599 * qty, method: "efectivo" }],
  status: "pagado",
  seller: "Karla",
  ...extra,
});

// ---------------------------------------------------------------------------
// Ventas y folios (negocio A)
// ---------------------------------------------------------------------------
const { data: o1, error: o1Err } = await seller.db.rpc("create_order", { p: order(pA, vkA, centro.id, 1) });
check("vendedor cobra en el mostrador de su sucursal", !o1Err && o1?.folio === "V-1001", o1Err?.message ?? o1?.folio);
await expectError("vendedor solo vende en su sucursal asignada", seller.db.rpc("create_order", { p: order(pA, vkA, principalA.id, 1) }), /sucursal asignada/);
await expectError("no permite sobreventa", seller.db.rpc("create_order", { p: order(pA, vkA, centro.id, 5) }), /Sin existencia/);

// Ventas simultáneas por las 2 últimas piezas: solo una debe pasar si piden 2 cada una
const [a, b] = await Promise.all([seller.db.rpc("create_order", { p: order(pA, vkA, centro.id, 2) }), ownerA.db.rpc("create_order", { p: order(pA, vkA, centro.id, 2) })]);
check("ventas simultáneas no sobrevenden", [a, b].filter((r) => !r.error).length === 1, [a.error?.message, b.error?.message].filter(Boolean).join(" | "));
const { data: st } = await ownerA.db.from("stock").select("qty").eq("variant_key", vkA).eq("branch", centro.id).single();
check("existencia final = 0", st?.qty === 0, `qty=${st?.qty}`);

const sold = a.error ? b.data : a.data;
// Costo oculto: solo el dueño lo lee, también por API; el unitCost que manda el cliente se ignora
const { data: sellerPc } = await seller.db.from("product_costs").select("*");
const { data: sellerOc } = await seller.db.from("order_costs").select("*");
check("vendedor no lee product_costs ni order_costs", sellerPc?.length === 0 && sellerOc?.length === 0, `${sellerPc?.length}/${sellerOc?.length} filas`);
const { data: sellerProducts } = await seller.db.from("products").select("*");
check("products no trae la columna cost", sellerProducts?.length > 0 && sellerProducts.every((r) => !("cost" in r)));
check("orders.items de una venta no tienen unitCost", o1?.items?.every((i) => !("unitCost" in i)));
await expectError("vendedor no escribe product_costs", seller.db.from("product_costs").update({ cost: 0 }).eq("product_id", pA.id).select().single());
const { data: ownerPc } = await ownerA.db.from("product_costs").select("*");
check("dueño lee product_costs de su negocio", ownerPc?.length === 1 && ownerPc[0].product_id === pA.id && ownerPc[0].cost === 255, JSON.stringify(ownerPc));
const { data: ownerOc } = await ownerA.db.from("order_costs").select("*").eq("order_id", o1.id).single();
check("create_order ignora el unitCost del cliente y guarda el costo real", ownerOc?.costs?.[vkA] === 255, JSON.stringify(ownerOc?.costs));

check("el folio es consecutivo dentro del negocio", sold?.folio === "V-1002", sold?.folio);
const { error: cErr } = await ownerA.db.rpc("set_order_status", { p_order: sold.id, p_status: "cancelado" });
const { data: st2 } = await ownerA.db.from("stock").select("qty").eq("variant_key", vkA).eq("branch", centro.id).single();
check("cancelar regresa las piezas", !cErr && st2?.qty === 2, cErr?.message ?? `qty=${st2?.qty}`);

// Pagos y apartados
const layawayInput = { ...order(pA, vkA, centro.id, 1), channel: "whatsapp", payments: [{ amount: 300, method: "transferencia" }] };
delete layawayInput.status;
const { data: layaway } = await seller.db.rpc("create_order", { p: layawayInput });
check("anticipo deja el pedido apartado", layaway?.status === "apartado", layaway?.status);
check("el pedido ganador de la carrera no deja huecos en los folios", layaway?.folio === "V-1003", layaway?.folio);
const { data: paid } = await seller.db.rpc("add_payment", { p_order: layaway.id, p_payment: { amount: 299, method: "transferencia" } });
check("liquidar lo marca pagado", paid?.status === "pagado", paid?.status);
await expectError("vendedor no cancela pedidos", seller.db.rpc("set_order_status", { p_order: layaway.id, p_status: "cancelado" }), /Solo el dueño o el encargado cancelan pedidos/);
const { data: encCancel, error: encCancelErr } = await encargado.db.rpc("set_order_status", { p_order: layaway.id, p_status: "cancelado" });
check("encargado cancela pedidos y regresa las piezas", !encCancelErr && encCancel?.status === "cancelado", encCancelErr?.message);

// Clientes, cotización y conversión
const { data: custA, error: custErr } = await seller.db
  .from("customers")
  .insert({ name: "Cliente Mayorista", business: "Tienda Mayorista", phone: "555 000 0000", city: "Ciudad", state: "Estado", type: "distribuidor" })
  .select()
  .single();
check("vendedor registra cliente", !custErr, custErr?.message);
await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 20 }], p_branch: principalA.id, p_type: "entrada" });
// Nivel de mayoreo de A guardado en settings: 20 % de descuento → round(599 × 0.8 / 5) × 5 = 480 (create_order lo lee de ahí).
const { data: wsA } = await ownerA.db.from("settings").select("value").eq("key", "wholesale").single();
const { error: tierErr } = await ownerA.db.from("settings").update({ value: { ...wsA.value, tiers: [...wsA.value.tiers, { id: "mayoreo", name: "Mayoreo", minPieces: 6, discount: 0.2, description: "" }] } }).eq("key", "wholesale");
check("dueño define un nivel de mayoreo en la configuración", !tierErr, tierErr?.message);
// Totales falsos a propósito: save_quote los recalcula en el servidor.
const quoteOf = (customer, product, vk, price = 469, tierId = "lista") => ({
  customerId: customer.id,
  customerName: customer.business,
  items: [{ ...item(product, vk, 12), unitPrice: price }],
  tierId,
  subtotalList: 7188,
  discount: 7188 - 12 * price,
  subtotal: 12 * price,
  shipping: 280,
  total: 12 * price + 280,
  depositPct: 0.5,
  status: "enviada",
  validUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
});
const { data: qA, error: qErr } = await seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkA, 480, "mayoreo") });
check("folio de cotización del negocio", !qErr && qA?.folio === "COT-0001", qErr?.message ?? qA?.folio);
check("save_quote guarda los items sin unitCost", qA?.items?.every((i) => !("unitCost" in i)));
check("save_quote recalcula lista, descuento, subtotal y total en el servidor", qA?.subtotal_list === 7188 && qA.discount === 1428 && qA.subtotal === 5760 && qA.total === 6040, `${qA?.subtotal_list}/${qA?.discount}/${qA?.subtotal}/${qA?.total}`);
// Se edita qA (con su id) para no gastar un folio.
const { data: qFake } = await ownerA.db.rpc("save_quote", { p: { ...quoteOf(custA, pA, vkA, 480, "mayoreo"), id: qA.id, subtotal: 1, total: 1, discount: 9999, subtotalList: 1 } });
check("totales falsos del navegador se ignoran", qFake?.id === qA.id && qFake.subtotal === 5760 && qFake.total === 6040 && qFake.discount === 1428, `${qFake?.subtotal}/${qFake?.total}`);
await expectError("save_quote solo guarda borrador o enviada", seller.db.rpc("save_quote", { p: { ...quoteOf(custA, pA, vkA, 480, "mayoreo"), status: "aceptada" } }), /Estado de cotización inválido/);
await expectError("vendedor no cotiza debajo del piso de su nivel", seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkA, 469, "mayoreo") }), /Precio menor al de catálogo/);
await expectError("save_quote rechaza renglones con variantKey repetido", ownerA.db.rpc("save_quote", { p: { ...quoteOf(custA, pA, vkA, 480, "mayoreo"), items: [quoteOf(custA, pA, vkA, 480, "mayoreo").items[0], quoteOf(custA, pA, vkA, 480, "mayoreo").items[0]] } }), /Producto repetido/);
await expectError("save_quote rechaza cantidades no enteras", ownerA.db.rpc("save_quote", { p: { ...quoteOf(custA, pA, vkA, 480, "mayoreo"), items: [{ ...quoteOf(custA, pA, vkA, 480, "mayoreo").items[0], qty: 1.5 }] } }), /Cantidad inválida/);
await expectError("save_quote rechaza un anticipo fuera de 0..1", ownerA.db.rpc("save_quote", { p: { ...quoteOf(custA, pA, vkA, 480, "mayoreo"), depositPct: 2 } }), /Anticipo inválido/);
await expectError("save_quote rechaza un envío NaN", ownerA.db.rpc("save_quote", { p: { ...quoteOf(custA, pA, vkA, 480, "mayoreo"), shipping: "NaN" } }), /Envío inválido/);
await expectDenied("la cotización ya no se edita con UPDATE directo", seller.db.from("quotes").update({ status: "aceptada" }).eq("id", qA.id).select());
const { data: qSt, error: qStErr } = await seller.db.rpc("set_quote_status", { p_id: qA.id, p_status: "aceptada" });
check("set_quote_status cambia el estado", !qStErr && qSt?.status === "aceptada", qStErr?.message);
await expectError("set_quote_status nunca va hacia convertida", seller.db.rpc("set_quote_status", { p_id: qA.id, p_status: "convertida" }), /La cotización ya es un pedido/);
await expectError("set_quote_status rechaza un estado inexistente", seller.db.rpc("set_quote_status", { p_id: qA.id, p_status: "perdida" }), /Estado de cotización inválido/);
await expectError("anon no ejecuta set_quote_status", anon.rpc("set_quote_status", { p_id: qA.id, p_status: "aceptada" }), /permission denied/);
const { data: conv, error: convErr } = await seller.db.rpc("convert_quote", { p_quote: qA.id, p_deposit: { amount: 2954, method: "transferencia", note: "Anticipo" } });
check("cotización → pedido apartado de mayoreo", !convErr && conv?.status === "apartado" && conv?.channel === "mayoreo", convErr?.message ?? conv?.status);
check("el mayoreo se aparta de la sucursal que lo surte", conv?.branch === principalA.id);
check("la conversión toma el siguiente folio de pedido", conv?.folio === "V-1004", conv?.folio);
await expectError("no se convierte dos veces", seller.db.rpc("convert_quote", { p_quote: qA.id, p_deposit: {} }), /ya es un pedido/);
const { data: qA2 } = await seller.db.rpc("save_quote", { p: quoteOf(custA, pA, vkA, 480, "mayoreo") });
check("la segunda cotización lleva el siguiente folio", qA2?.folio === "COT-0002", qA2?.folio);
await expectError("set_quote_status no sale de convertida", seller.db.rpc("set_quote_status", { p_id: qA.id, p_status: "borrador" }), /La cotización ya es un pedido/);
await ownerA.db.from("branches").update({ is_warehouse: false }).eq("id", principalA.id);
await expectError("convertir exige una sucursal que surta mayoreo", seller.db.rpc("convert_quote", { p_quote: qA2.id, p_deposit: {} }), /Configura qué sucursal surte el mayoreo/);
await ownerA.db.from("branches").update({ is_warehouse: true }).eq("id", principalA.id);

// Traspaso y conteo: el vendedor ya no puede; encargado y dueño sí
await expectError("vendedor no traspasa", seller.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkA, qty: 3 }], p_from: principalA.id, p_to: bodega.id }), NO_STOCK);
await expectError("vendedor no cuenta el inventario", seller.db.rpc("set_stock_count", { p_branch: bodega.id, p_entries: [{ variantKey: vkA, qty: 10 }] }), NO_STOCK);
const { error: trErr } = await encargado.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkA, qty: 3 }], p_from: principalA.id, p_to: bodega.id });
check("encargado traspasa entre sucursales (aunque no sea la suya)", !trErr, trErr?.message);
const { data: trMov } = await ownerA.db.from("movements").select("note, branch").eq("type", "traspaso").eq("branch", principalA.id).limit(1).single();
check("el kardex anota el destino del traspaso", trMov?.note === "Hacia Sucursal Norte", trMov?.note);
const { data: changed, error: cntErr } = await encargado.db.rpc("set_stock_count", { p_branch: bodega.id, p_entries: [{ variantKey: vkA, qty: 10 }] });
check("encargado fija la existencia con un conteo físico", !cntErr && changed === 1, cntErr?.message);
const { data: ownerCount, error: ownerCountErr } = await ownerA.db.rpc("set_stock_count", { p_branch: bodega.id, p_entries: [{ variantKey: vkA, qty: 10 }] });
check("el dueño también cuenta (sin cambios no hay movimiento)", !ownerCountErr && ownerCount === 0, ownerCountErr?.message);
const { error: ownerTrErr } = await ownerA.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkA, qty: 0 }], p_from: principalA.id, p_to: bodega.id });
check("el dueño también traspasa (en 0 no mueve nada)", !ownerTrErr, ownerTrErr?.message);

// Gastos: solo dueño
const { error: exErr } = await ownerA.db.from("expenses").insert({ category: "renta", description: "Renta del local", amount: 22000, method: "transferencia" });
check("dueño registra gasto", !exErr, exErr?.message);
const { data: sellerExpenses } = await seller.db.from("expenses").select("*");
check("vendedor no ve gastos", Array.isArray(sellerExpenses) && sellerExpenses.length === 0);
check("encargado no ve gastos ni costos", (await encargado.db.from("expenses").select("id")).data?.length === 0 && (await encargado.db.from("product_costs").select("*")).data?.length === 0);
await expectError("encargado no registra gastos", encargado.db.from("expenses").insert({ category: "otros", description: "x", amount: 1, method: "efectivo" }).select().single());
await expectError("encargado no edita el negocio", encargado.db.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" }), /Solo el dueño/);
await expectError("encargado no administra el equipo", encargado.db.rpc("set_member", { p_id: seller.id, p_role: "encargado", p_branch: null }), /Solo el dueño/);
await expectError("vendedor no registra gastos", seller.db.from("expenses").insert({ category: "otros", description: "x", amount: 1, method: "efectivo" }).select().single());

// Configuración y administración del negocio
const { data: sellerCfg } = await seller.db.from("settings").select("key");
check("vendedor lee la configuración", sellerCfg?.length === 4, `${sellerCfg?.length} llaves`);
await expectDenied("vendedor no cambia la configuración", seller.db.from("settings").update({ value: { enabled: true } }).eq("key", "wholesale").select());
await expectError("vendedor no edita el negocio", seller.db.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" }), /Solo el dueño/);
await expectError("vendedor no renueva el código de invitación", seller.db.rpc("regenerate_invite_code"), /Solo el dueño/);
const { data: team } = await ownerA.db.from("profiles").select("id");
check("dueño ve a todo su equipo", team?.length === 4, `${team?.length} perfiles`);
const { data: ownProfiles } = await seller.db.from("profiles").select("id");
check("vendedor solo ve su propio perfil", ownProfiles?.length === 1);
const { data: movs } = await ownerA.db.from("movements").select("type");
check("kardex registra movimientos", (movs?.length ?? 0) >= 8, `${movs?.length} movimientos`);

const oldCode = bizA.invite_code;
const { data: newCode, error: regenErr } = await ownerA.db.rpc("regenerate_invite_code");
check("dueño renueva el código de invitación", !regenErr && /^[A-Z2-9]{8}$/.test(newCode ?? "") && newCode !== oldCode, regenErr?.message);
const { data: oldLookup } = await inviteLookup(anon, oldCode);
check("el código anterior deja de funcionar", oldLookup === null);
const { data: stillB } = await inviteLookup(anon, bizB.invite_code);
check("renovar el código de A no afecta a B", stillB === "Boutique Beta");

// ---------------------------------------------------------------------------
// Negocio B: datos propios, folios propios
// ---------------------------------------------------------------------------
const { data: pB, error: pBErr } = await ownerB.db
  .from("products")
  .insert({ sku: "T-001", name: "Polo prueba", brand: "Marca", category: "Polos", price: 299, sizes: ["S", "M"], colors, woo_id: 1 })
  .select()
  .single();
check("el mismo woo_id se puede usar en otro negocio", !pBErr, pBErr?.message);
await ownerB.db.from("product_costs").insert({ product_id: pB.id, cost: 100 });
const vkB = `${pB.id}|Negro|M`;
check("producto de B solo crea filas de las sucursales de B", (await stockRows(ownerB.db, pB.id)) === 2);
await ownerB.db.rpc("move_stock", { p_entries: [{ variantKey: vkB, qty: 10 }], p_branch: principalB.id, p_type: "entrada" });
const { data: oB1, error: oB1Err } = await ownerB.db.rpc("create_order", { p: order(pB, vkB, principalB.id, 1, { seller: "Dueño Beta" }) });
check("el primer folio de B también es V-1001", !oB1Err && oB1?.folio === "V-1001", oB1Err?.message ?? oB1?.folio);

await expectError("prefijo de folio vacío", ownerB.db.rpc("update_business", { p_name: "Boutique Beta", p_order_prefix: "", p_quote_prefix: "PRE-" }), /vacíos/);
await expectError("prefijo de folio de más de 10 caracteres", ownerB.db.rpc("update_business", { p_name: "Boutique Beta", p_order_prefix: "ABCDEFGHIJK", p_quote_prefix: "PRE-" }), /10 caracteres/);
const { data: renamed, error: renErr } = await ownerB.db.rpc("update_business", { p_name: "Boutique Beta", p_order_prefix: "BT-", p_quote_prefix: "PRE-" });
check("dueño cambia los prefijos de folio", !renErr && renamed?.order_prefix === "BT-", renErr?.message);
const { data: oB2 } = await ownerB.db.rpc("create_order", { p: order(pB, vkB, principalB.id, 1, { seller: "Dueño Beta" }) });
check("el pedido siguiente usa el prefijo nuevo", oB2?.folio === "BT-1002", oB2?.folio);
const { data: custB } = await ownerB.db.from("customers").insert({ name: "Cliente Beta", business: "Tienda Beta", phone: "555 111 1111", type: "mayorista" }).select().single();
const { data: qB } = await ownerB.db.rpc("save_quote", { p: quoteOf(custB, pB, vkB) });
check("cotización de B empieza en su propio contador", qB?.folio === "PRE-0001", qB?.folio);
await ownerB.db.from("expenses").insert({ category: "otros", description: "Gasto de B", amount: 100, method: "efectivo" });
const { data: nextA } = await ownerA.db.rpc("create_order", { p: order(pA, vkA, centro.id, 1, { seller: "Dueña Alfa" }) });
check("los folios de A no se mueven con los de B", nextA?.folio === "V-1005", nextA?.folio);
const { data: bizAAfter } = await ownerA.db.from("businesses").select("name, order_prefix").single();
check("editar B no cambia el nombre ni el prefijo de A", bizAAfter?.name === "Boutique Alfa" && bizAAfter?.order_prefix === "V-");

// ---------------------------------------------------------------------------
// Aislamiento: un negocio no lee ni escribe datos del otro
// ---------------------------------------------------------------------------
for (const [who, db, own, other] of [
  ["B", ownerB.db, bizB.id, bizA.id],
  ["A", ownerA.db, bizA.id, bizB.id],
]) {
  for (const table of ["businesses", "branches", "business_members", "settings", "products", "stock", "movements", "customers", "orders", "quotes", "expenses", "product_costs", "order_costs"]) {
    const { data: rows, error } = await db.from(table).select("*");
    const idOf = (r) => (table === "businesses" ? r.id : r.business_id);
    check(`${who} solo lee filas de su negocio en ${table}`, !error && rows.length > 0 && rows.every((r) => idOf(r) === own) && !rows.some((r) => idOf(r) === other), error?.message ?? `${rows?.length} filas`);
  }
}
const { data: pFromB } = await ownerB.db.from("products").select("id").eq("id", pA.id);
check("B no lee un producto de A por su id", pFromB?.length === 0);
const { data: pcFromB } = await ownerB.db.from("product_costs").select("*").eq("product_id", pA.id);
const { data: ocFromB } = await ownerB.db.from("order_costs").select("*").eq("order_id", o1.id);
check("B no lee el costo de un producto ni de un pedido de A", pcFromB?.length === 0 && ocFromB?.length === 0);
const { data: oFromB } = await ownerB.db.from("orders").select("id").eq("id", o1.id);
check("B no lee un pedido de A por su id", oFromB?.length === 0);
const { data: profFromB } = await ownerB.db.from("profiles").select("id").eq("id", seller.id);
check("B no lee el perfil de un miembro de A", profFromB?.length === 0);

await expectDenied("B no edita productos de A", ownerB.db.from("products").update({ price: 1 }).eq("id", pA.id).select());
await expectDenied("B no borra productos de A", ownerB.db.from("products").delete().eq("id", pA.id).select());
await expectDenied("B no edita clientes de A", ownerB.db.from("customers").update({ name: "Hackeado" }).eq("id", custA.id).select());
await expectDenied("B no edita cotizaciones de A", ownerB.db.from("quotes").update({ status: "rechazada" }).eq("id", qA2.id).select());
await expectError("B no cambia el estado de una cotización de A", ownerB.db.rpc("set_quote_status", { p_id: qA2.id, p_status: "rechazada" }), /Cotización no encontrada/);
await expectDenied("B no edita la membresía de un miembro de A", ownerB.db.from("business_members").update({ role: "pendiente" }).eq("user_id", seller.id).select());
await expectDenied("B no edita la configuración de A", ownerB.db.from("settings").update({ value: { enabled: true } }).eq("business_id", bizA.id).select());
await expectDenied("B no edita sucursales de A", ownerB.db.from("branches").update({ name: "Hackeada" }).eq("id", principalA.id).select());
await expectDenied("B no edita el negocio A", ownerB.db.from("businesses").update({ name: "Hackeado" }).eq("id", bizA.id).select());
await expectDenied("B no borra pedidos de A", ownerB.db.from("orders").delete().eq("id", o1.id).select());
await expectError("B no inserta productos en A", ownerB.db.from("products").insert({ business_id: bizA.id, sku: "H-1", name: "Intruso", category: "Polos", price: 1, sizes: ["M"] }).select());
await expectError("B no inserta sucursales en A", ownerB.db.from("branches").insert({ business_id: bizA.id, name: "Intrusa", short: "X" }).select());
await expectError("B no inserta clientes en A", ownerB.db.from("customers").insert({ business_id: bizA.id, name: "Intruso", phone: "1" }).select());
await expectError("B no inserta gastos en A", ownerB.db.from("expenses").insert({ business_id: bizA.id, category: "otros", description: "x", amount: 1, method: "efectivo" }).select());
await expectError("B no inserta configuración en A", ownerB.db.from("settings").insert({ business_id: bizA.id, key: "extra", value: {} }).select());
await expectError("B no inserta pedidos en A", ownerB.db.from("orders").insert({ business_id: bizA.id, folio: "H-1", channel: "tienda", customer_name: "x", branch: principalA.id, items: [], subtotal: 0, total: 0, status: "pagado" }).select());

// RPC con datos de otro negocio
await expectError("B no vende desde una sucursal de A", ownerB.db.rpc("create_order", { p: order(pA, vkA, principalA.id, 1) }), /Sucursal inválida/);
await expectError("B no vende a un cliente de A", ownerB.db.rpc("create_order", { p: order(pB, vkB, principalB.id, 1, { customerId: custA.id }) }), /Cliente inválido/);
await expectError("B no vende una variante de A", ownerB.db.rpc("create_order", { p: order(pA, vkA, principalB.id, 1) }), /Sin existencia/);
await expectError("B no mueve inventario de una sucursal de A", ownerB.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 5 }], p_branch: principalA.id, p_type: "entrada" }), /Sucursal inválida/);
await expectError("B no mueve variantes de A en su sucursal", ownerB.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 5 }], p_branch: principalB.id, p_type: "entrada" }), /Variante inexistente/);
await expectError("B no traspasa hacia una sucursal de A", ownerB.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkB, qty: 1 }], p_from: principalB.id, p_to: principalA.id }), /Sucursal inválida/);
await expectError("B no traspasa desde una sucursal de A", ownerB.db.rpc("transfer_stock", { p_entries: [{ variantKey: vkA, qty: 1 }], p_from: principalA.id, p_to: principalB.id }), /Sucursal inválida/);
await expectError("B no cuenta el inventario de una sucursal de A", ownerB.db.rpc("set_stock_count", { p_branch: principalA.id, p_entries: [{ variantKey: vkA, qty: 99 }] }), /Sucursal inválida/);
await expectError("B no cambia el estado de un pedido de A", ownerB.db.rpc("set_order_status", { p_order: o1.id, p_status: "cancelado" }), /Pedido no encontrado/);
await expectError("B no registra pagos en un pedido de A", ownerB.db.rpc("add_payment", { p_order: o1.id, p_payment: { amount: 1, method: "efectivo" } }), /Pedido no encontrado/);
await expectError("B no cotiza a un cliente de A", ownerB.db.rpc("save_quote", { p: quoteOf(custA, pB, vkB) }), /Cliente inválido/);
await expectError("B no convierte una cotización de A", ownerB.db.rpc("convert_quote", { p_quote: qA2.id, p_deposit: {} }), /Cotización no encontrada/);
await expectError("B no administra miembros de A", ownerB.db.rpc("set_member", { p_id: seller.id, p_role: "pendiente", p_branch: null }), /Colaborador no encontrado/);
await expectError("B no asigna sucursales de A a su equipo", ownerB.db.rpc("set_member", { p_id: pending.id, p_role: "vendedor", p_branch: principalA.id }), /Sucursal inválida/);

// Existencia de la principal de A: 20 de entrada − 12 de la conversión − 3 del traspaso
const { data: afterStock } = await ownerA.db.from("stock").select("qty").eq("variant_key", vkA).eq("branch", principalA.id).single();
const { data: oAfter } = await ownerA.db.from("orders").select("status").eq("id", o1.id).single();
check("tras los intentos de B, el inventario y los pedidos de A siguen intactos", afterStock?.qty === 5 && oAfter?.status === "pagado", `qty=${afterStock?.qty} status=${oAfter?.status}`);

// ---------------------------------------------------------------------------
// invite-lookup: máximo 30 intentos por IP (cf-connecting-ip) en 10 minutos
// ---------------------------------------------------------------------------
const limited = newClient(fakeIp());
let answered = 0;
for (let i = 0; i < 30; i++) if (!(await inviteLookup(limited, "ZZZZZZZZ")).error) answered++;
check("invite-lookup responde las primeras 30 llamadas de una IP", answered === 30, `${answered} respuestas`);
const over = await inviteLookup(limited, "ZZZZZZZZ", { "x-forwarded-for": fakeIp() });
check("la llamada 31 se rechaza con 429 aunque cambie x-forwarded-for", over.error?.status === 429 && /Demasiados intentos/.test(over.error.message), over.error?.message ?? "no hubo error");
const burst = newClient(fakeIp());
const burstAnswered = (await Promise.all(Array.from({ length: 40 }, () => inviteLookup(burst, "ZZZZZZZZ")))).filter((r) => !r.error).length;
check("una ráfaga de 40 en paralelo responde solo 30", burstAnswered === 30, `${burstAnswered} respuestas`);
const { data: otherKey, error: otherKeyErr } = await inviteLookup(newClient(fakeIp()), bizB.invite_code);
check("otra IP sigue respondiendo", !otherKeyErr && otherKey === "Boutique Beta", otherKeyErr?.message);

// ---------------------------------------------------------------------------
// Logotipos: cada dueño escribe solo en la carpeta de su negocio
// ---------------------------------------------------------------------------
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const upload = (db, path, body = png, contentType = "image/png") => db.storage.from("logos").upload(path, body, { contentType, upsert: true });
const { error: logoErr } = await upload(ownerA.db, `${bizA.id}/logo.png`);
check("dueño sube el logotipo a la carpeta de su negocio", !logoErr, logoErr?.message);
await expectError("B no sube archivos a la carpeta de A", upload(ownerB.db, `${bizA.id}/intruso.png`));
await expectError("vendedor no sube logotipos", upload(seller.db, `${bizA.id}/vendedor.png`));
await expectError("el bucket rechaza tipos que no son imagen", upload(ownerA.db, `${bizA.id}/nota.txt`, Buffer.from("hola"), "text/plain"));
const { data: publicUrl } = ownerA.db.storage.from("logos").getPublicUrl(`${bizA.id}/logo.png`);
const logoRes = await fetch(publicUrl.publicUrl);
check("el logotipo es público", logoRes.ok, `HTTP ${logoRes.status}`);
await expectDenied("B no borra el logotipo de A", ownerB.db.storage.from("logos").remove([`${bizA.id}/logo.png`]));
const { error: rmErr } = await ownerA.db.storage.from("logos").remove([`${bizA.id}/logo.png`]);
check("dueño borra su propio logotipo", !rmErr, rmErr?.message);

// ---------------------------------------------------------------------------
// Membresía: prueba, gracia, bloqueo al vencer, pago manual y suspensión (las fechas se mueven con la llave de servicio)
// ---------------------------------------------------------------------------
const admin = await platformAdmin(mail("admin"));
const ownerM = await user(mail("dueno-m"), { name: "Dueña Mu", business_name: "Boutique Mu" });
const { data: bizM } = await ownerM.db.from("businesses").select("id").single();
const mem = async (db) => (await db.rpc("my_membership")).data;
const setBiz = (fields) => service.from("businesses").update(fields).eq("id", bizM.id);
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const bizState = async (id) => (await service.from("businesses").select("paid_until, suspended_at, trial_ends_at").eq("id", id).single()).data;

const { data: pM } = await ownerM.db.from("products").insert({ sku: "M-001", name: "Polo Mu", category: "Polos", price: 599, sizes: ["M"], colors, woo_id: 1 }).select().single();
const vkM = `${pM.id}|Negro|M`;
const { data: branchM } = await ownerM.db.from("branches").select("id").single();
await ownerM.db.rpc("move_stock", { p_entries: [{ variantKey: vkM, qty: 50 }], p_branch: branchM.id, p_type: "entrada" });
const { data: custM } = await ownerM.db.from("customers").insert({ name: "Mayorista Mu", business: "Mu", phone: "555", city: "Ciudad", state: "Estado", type: "distribuidor" }).select().single();
const sellM = () => ownerM.db.rpc("create_order", { p: order(pM, vkM, branchM.id, 1) });
const quoteM = () => ownerM.db.rpc("save_quote", { p: quoteOf(custM, pM, vkM) });
const expenseM = () => ownerM.db.from("expenses").insert({ category: "otros", description: "x", amount: 1, method: "efectivo" }).select();

const m0 = await mem(ownerM.db);
const trialDays = (new Date(m0?.trialEndsAt) - Date.now()) / 864e5;
check("negocio nuevo empieza en prueba de 14 días", m0?.state === "prueba" && m0.paidUntil === null && trialDays > 13.9 && trialDays <= 14, `${m0?.state} ${trialDays}`);
await expectError("la app no lee platform_admins", ownerM.db.from("platform_admins").select("user_id"));
await expectError("la app no lee membership_events", ownerM.db.from("membership_events").select("id"));
check("durante la prueba hay Mayoreo y Finanzas", !(await quoteM()).error && !(await expenseM()).error);
const { data: qM } = await quoteM();

// Prueba vencida sin pago: la cuenta se bloquea igual que una suspendida
await setBiz({ trial_ends_at: daysAgo(0.05) });
const m1 = await mem(ownerM.db);
check("prueba vencida → vencida", m1?.state === "vencida" && m1.paidUntil === null, m1?.state);
await expectError("vencida no vende", sellM(), /Membresía vencida/);
await expectError("vencida no cotiza", quoteM(), /Membresía vencida/);
await expectError("vencida no convierte cotizaciones", ownerM.db.rpc("convert_quote", { p_quote: qM.id, p_deposit: {} }), /Membresía vencida/);
await expectError("vencida no cambia el estado de cotizaciones", ownerM.db.rpc("set_quote_status", { p_id: qM.id, p_status: "aceptada" }), /Membresía vencida/);
await expectError("vencida no registra gastos", expenseM());
check("vencida no lee sus tablas", (await ownerM.db.from("products").select("id")).data?.length === 0 && (await ownerM.db.from("quotes").select("id")).data?.length === 0);
check("vencida sigue leyendo su perfil y su membresía", (await ownerM.db.from("profiles").select("id").eq("id", ownerM.id)).data?.length === 1 && (await ownerM.db.from("business_members").select("role").eq("user_id", ownerM.id)).data?.[0]?.role === "dueno");

// Periodo pagado vencido: 3 días de gracia con todo el sistema, después bloqueo
await setBiz({ paid_until: daysAgo(1) });
const m2 = await mem(ownerM.db);
const graceMs = new Date(m2?.graceEndsAt) - new Date(m2?.paidUntil);
check("en gracia avisa cuándo termina", m2?.state === "gracia" && graceMs === 3 * 864e5, m2?.state);
check("en gracia sigue vendiendo, cotizando y con Finanzas", !(await sellM()).error && !(await quoteM()).error && !(await expenseM()).error);
await setBiz({ paid_until: daysAgo(4) });
const m3 = await mem(ownerM.db);
check("pasada la gracia queda vencida", m3?.state === "vencida", m3?.state);
await expectError("pasada la gracia no vende", sellM(), /Membresía vencida/);

// Marcar pagado: el periodo corre desde el pago y desbloquea
await expectError("no se marcan más de 24 meses", admin.db.rpc("admin_mark_paid", { p_business: bizM.id, p_months: 25, p_amount: 100, p_note: null }), /Meses inválidos/);
await expectError("no se marcan 0 meses", admin.db.rpc("admin_mark_paid", { p_business: bizM.id, p_months: 0, p_amount: 100, p_note: null }), /Meses inválidos/);
await expectError("meses nulos se rechazan al marcar pagado", admin.db.rpc("admin_mark_paid", { p_business: bizM.id, p_months: null, p_amount: 100, p_note: null }), /Meses inválidos/);
const { error: payErr } = await admin.db.rpc("admin_mark_paid", { p_business: bizM.id, p_months: 1, p_amount: 4798, p_note: "Alta + primera mensualidad" });
const m4 = await mem(ownerM.db);
const paidDays = (new Date(m4?.paidUntil) - Date.now()) / 864e5;
check("marcar pagado cuenta el mes desde hoy y desbloquea", !payErr && m4?.state === "activa" && paidDays > 27 && paidDays < 32, payErr?.message ?? `${m4?.state} ${paidDays}`);
check("tras pagar vuelve a vender, cotizar y registrar gastos", !(await sellM()).error && !(await quoteM()).error && !(await expenseM()).error);
check("tras pagar conserva sus cotizaciones", (await ownerM.db.from("quotes").select("id")).data?.length === 4);
await admin.db.rpc("admin_mark_paid", { p_business: bizM.id, p_months: 1, p_amount: 1199, p_note: null });
const m5 = await mem(ownerM.db);
const stepDays = (new Date(m5?.paidUntil) - new Date(m4?.paidUntil)) / 864e5;
check("un segundo pago suma desde el vencimiento vigente", stepDays >= 28 && stepDays <= 31, `${stepDays} días`);

// Suspender: la base niega todo salvo el perfil propio y my_membership
const { error: susErr } = await admin.db.rpc("admin_suspend", { p_business: bizM.id, p_reason: "Contracargo" });
check("el administrador suspende un negocio", !susErr, susErr?.message);
check("suspendido no lee sus tablas", (await ownerM.db.from("products").select("id")).data?.length === 0 && (await ownerM.db.from("businesses").select("id")).data?.length === 0);
await expectError("suspendido no vende", sellM(), /Cuenta suspendida/);
await expectError("suspendido no cotiza", quoteM(), /Cuenta suspendida/);
await expectError("suspendido no mueve inventario", ownerM.db.rpc("move_stock", { p_entries: [{ variantKey: vkM, qty: 1 }], p_branch: branchM.id, p_type: "entrada" }), /Cuenta suspendida/);
await expectError("suspendido no renueva el código de invitación", ownerM.db.rpc("regenerate_invite_code"), /Cuenta suspendida/);
await expectError("suspendido no edita el negocio", ownerM.db.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" }), /Cuenta suspendida/);
await expectError("suspendido no administra el equipo", ownerM.db.rpc("set_member", { p_id: ownerM.id, p_role: "vendedor", p_branch: null }), /Cuenta suspendida/);
await expectError("suspendido no escribe gastos", expenseM());
const m6 = await mem(ownerM.db);
check("my_membership responde con la cuenta suspendida", m6?.state === "suspendida" && m6.suspendedReason === "Contracargo", m6?.state);
check("el perfil propio y la membresía siguen legibles", (await ownerM.db.from("profiles").select("id").eq("id", ownerM.id)).data?.length === 1 && (await ownerM.db.from("business_members").select("role").eq("user_id", ownerM.id)).data?.[0]?.role === "dueno");
check("my_businesses sigue respondiendo con la cuenta suspendida", (await ownerM.db.rpc("my_businesses")).data?.[0]?.state === "suspendida");
await admin.db.rpc("admin_reactivate", { p_business: bizM.id });
const m7 = await mem(ownerM.db);
check("reactivar devuelve el acceso", m7?.state === "activa" && m7.suspendedReason === null && !(await sellM()).error && (await ownerM.db.from("products").select("id")).data?.length === 1, m7?.state);

// Revisión: el negocio recién registrado espera al administrador; rechazar no borra nada y se puede aceptar después
const { client: ownerR, error: signUpR } = await signUp(mail("dueno-r"), { name: "Dueño Rho" });
await signIn(ownerR, mail("dueno-r"));
const bizR = await createBusiness(ownerR, "Boutique Rho", "boutique", { approved: false });
const editR = () => ownerR.rpc("update_business", { p_name: "Otro", p_order_prefix: "X-", p_quote_prefix: "Y-" });
const r0 = await mem(ownerR);
check("negocio nuevo nace en revisión", !signUpR && !!bizR && r0?.state === "revision", signUpR?.message ?? r0?.state);
check("en revisión no lee sus tablas", (await ownerR.from("branches").select("id")).data?.length === 0);
await expectError("en revisión no edita el negocio", editR(), /Cuenta en revisión/);
const rowR = (await admin.db.rpc("admin_businesses")).data?.find((r) => r.id === bizR);
check("el administrador ve la solicitud", rowR?.state === "revision" && rowR.owner_name === "Dueño Rho" && rowR.ends_at === null, JSON.stringify(rowR));
const { error: rejErr } = await admin.db.rpc("admin_reject", { p_business: bizR, p_reason: "Datos incompletos" });
const r1 = await mem(ownerR);
check("rechazar bloquea con el motivo", !rejErr && r1?.state === "rechazada" && r1.suspendedReason === "Datos incompletos", rejErr?.message ?? r1?.state);
await expectError("rechazada no edita el negocio", editR(), /Solicitud rechazada/);
await service.from("businesses").update({ trial_ends_at: daysAgo(30) }).eq("id", bizR);
const { error: okErr } = await admin.db.rpc("admin_approve", { p_business: bizR });
const r2 = await mem(ownerR);
const trialR = (new Date(r2?.trialEndsAt) - Date.now()) / 864e5;
check("aceptar (aun rechazada) abre la prueba completa desde hoy", !okErr && r2?.state === "prueba" && r2.suspendedReason === null && trialR > 13.9 && trialR <= 14, okErr?.message ?? `${r2?.state} ${trialR}`);
check("aceptado ya lee sus tablas", (await ownerR.from("branches").select("id")).data?.length === 1);
await expectError("no se acepta dos veces", admin.db.rpc("admin_approve", { p_business: bizR }), /no está en revisión/);
await expectError("no se rechaza un negocio aceptado", admin.db.rpc("admin_reject", { p_business: bizR, p_reason: "x" }), /no está en revisión/);
const actionsR = (await admin.db.rpc("admin_events", { p_business: bizR })).data?.map((e) => e.action).reverse().join();
check("el historial registra rechazar y aceptar", actionsR === "rechazar,aceptar", actionsR);

// Permisos: solo el administrador toca las admin_*; anon no ejecuta nada nuevo
const adminCalls = (db) => [
  ["admin_businesses", {}],
  ["admin_events", { p_business: bizM.id }],
  ["admin_mark_paid", { p_business: bizM.id, p_months: 1, p_amount: 0, p_note: null }],
  ["admin_suspend", { p_business: bizM.id, p_reason: "x" }],
  ["admin_reactivate", { p_business: bizM.id }],
  ["admin_approve", { p_business: bizM.id }],
  ["admin_reject", { p_business: bizM.id, p_reason: "x" }],
].map(([fn, args]) => [fn, db.rpc(fn, args)]);
for (const [fn, call] of adminCalls(ownerM.db)) await expectError(`un dueño no ejecuta ${fn}`, call, /Solo administradores de la plataforma/);
for (const [fn, call] of adminCalls(anon)) await expectError(`anon no ejecuta ${fn}`, call, /permission denied/);
for (const [fn, args] of [["my_membership", {}], ["is_platform_admin", {}]]) await expectError(`anon no ejecuta ${fn}`, anon.rpc(fn, args), /permission denied/);
check("is_platform_admin distingue al administrador", (await admin.db.rpc("is_platform_admin")).data === true && (await ownerM.db.rpc("is_platform_admin")).data === false);

// Las acciones solo tocan su negocio y el panel devuelve datos coherentes
const otherA = await bizState(bizA.id);
const otherB = await bizState(bizB.id);
await admin.db.rpc("admin_suspend", { p_business: bizM.id, p_reason: "Otra vez" });
await admin.db.rpc("admin_reactivate", { p_business: bizM.id });
check("las acciones sobre un negocio no tocan a los demás",
  JSON.stringify([otherA, otherB]) === JSON.stringify([await bizState(bizA.id), await bizState(bizB.id)]));
await expectError("una acción sobre un negocio inexistente falla", admin.db.rpc("admin_suspend", { p_business: "00000000-0000-0000-0000-000000000000", p_reason: "x" }), /Negocio no encontrado/);
const { data: rows } = await admin.db.rpc("admin_businesses");
const rowM = rows?.find((r) => r.id === bizM.id);
const ordersM = (await service.from("orders").select("id", { count: "exact", head: true }).eq("business_id", bizM.id)).count;
check("admin_businesses lista todos los negocios", [bizA.id, bizB.id, bizM.id].every((id) => rows?.some((r) => r.id === id)), `${rows?.length} filas`);
check("admin_businesses trae dueño, estado y actividad", rowM?.name === "Boutique Mu" && rowM.owner_email === ownerM.email && rowM.owner_name === "Dueña Mu"
  && rowM.state === "activa" && new Date(rowM.ends_at).getTime() === new Date(rowM.paid_until).getTime() && rowM.members === 1 && rowM.orders_30d === ordersM && ordersM >= 3, JSON.stringify(rowM));
const { data: events } = await admin.db.rpc("admin_events", { p_business: bizM.id });
const actions = events?.map((e) => e.action).reverse().join();
check("admin_events guarda cada cambio, el más nuevo primero", actions === "pago,pago,suspender,reactivar,suspender,reactivar" && events[0].action === "reactivar", actions);
const firstPay = events?.find((e) => e.note === "Alta + primera mensualidad");
check("el historial registra actor, vencimiento, monto y nota", firstPay?.actor_email === admin.email && firstPay.action === "pago" && Number(firstPay.amount) === 4798 && !!firstPay.paid_until);

// Datos de cobro: solo el administrador lee y edita la fila; los negocios la reciben en my_membership
const cobro = (db) => db.from("platform_settings").select("*");
const COBRO_INICIAL = { price_monthly: 1199, price_setup: 3599, bank: "", clabe: "", holder: "", whatsapp: "" };
check("un dueño no lee platform_settings", ((await cobro(ownerM.db)).data?.length ?? 0) === 0);
await expectError("anon no lee platform_settings", cobro(anon), /permission denied/);
await expectDenied("un dueño no edita platform_settings", ownerM.db.from("platform_settings").update({ price_monthly: 1 }).eq("id", true).select());
const { data: cobroAdmin } = await cobro(admin.db);
check("el administrador lee una sola fila con los precios iniciales", cobroAdmin?.length === 1 && Number(cobroAdmin[0].price_monthly) === 1199 && Number(cobroAdmin[0].price_setup) === 3599, JSON.stringify(cobroAdmin));
await expectError("no se agrega otra fila de cobro", admin.db.from("platform_settings").insert({ id: false }), /permission denied/);
const nuevoCobro = { price_monthly: 999, price_setup: 0, bank: "BBVA", clabe: "012180001234567899", holder: "Plataforma", whatsapp: "3310000000" };
const { error: cobroErr } = await admin.db.from("platform_settings").update(nuevoCobro).eq("id", true).select().single();
const m10 = await mem(ownerM.db);
check("el administrador edita el cobro y el negocio lo recibe en my_membership", !cobroErr && m10?.priceMonthly === 999 && m10.priceSetup === 0 && m10.payment.clabe === nuevoCobro.clabe && m10.payment.holder === "Plataforma", cobroErr?.message ?? JSON.stringify(m10));
await expectError("la CLABE lleva 18 dígitos", admin.db.from("platform_settings").update({ clabe: "123" }).eq("id", true), /platform_settings_clabe_check/);
await expectError("los precios no son negativos", admin.db.from("platform_settings").update({ price_monthly: -1 }).eq("id", true), /platform_settings_price_monthly_check/);
await admin.db.rpc("admin_suspend", { p_business: bizM.id, p_reason: null });
const m11 = await mem(ownerM.db);
check("con la cuenta suspendida sigue recibiendo a dónde pagar", m11?.state === "suspendida" && m11.payment.bank === "BBVA" && m11.priceMonthly === 999, JSON.stringify(m11));
await admin.db.rpc("admin_reactivate", { p_business: bizM.id });
await admin.db.from("platform_settings").update(COBRO_INICIAL).eq("id", true);

// ---------------------------------------------------------------------------
// create_order no confía en el navegador: precio mínimo, estado, vendedor y NaN (negocio A; el nivel "mayoreo" = 480)
// ---------------------------------------------------------------------------
await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 20 }], p_branch: centro.id, p_type: "entrada" });
await ownerA.db.rpc("move_stock", { p_entries: [{ variantKey: vkA, qty: 20 }], p_branch: principalA.id, p_type: "entrada" });
const priced = (price, extra = {}, qty = 1) =>
  order(pA, vkA, centro.id, qty, { items: [{ ...item(pA, vkA, qty), unitPrice: price }], payments: [{ amount: price * qty, method: "efectivo" }], ...extra });
const sell = (db, p) => db.rpc("create_order", { p });
const MIN_MSG = /Precio menor al de catálogo/;

await expectError("vendedor no vende debajo del precio de catálogo", sell(seller.db, priced(100)), MIN_MSG);
await expectError("vendedor no vende 1 centavo debajo del catálogo", sell(seller.db, priced(598.99)), MIN_MSG);
await expectError("un nivel con descuento 0 no baja el mínimo del catálogo", sell(seller.db, priced(469, { tierId: "lista" })), MIN_MSG);
await expectError("vendedor no vende debajo del precio de su nivel", sell(seller.db, priced(479, { tierId: "mayoreo" }, 6)), MIN_MSG);
await expectError("encargado tampoco vende debajo del precio de catálogo", sell(encargado.db, priced(100)), MIN_MSG);
await expectError("vendedor no usa un nivel sin alcanzar sus piezas mínimas", sell(seller.db, priced(480, { tierId: "mayoreo" }, 5)), /no alcanza las piezas mínimas/);
await expectError("pedido con variantKey repetido", sell(seller.db, { ...priced(599), items: [item(pA, vkA, 1), item(pA, vkA, 1)] }), /Producto repetido en el pedido/);
await expectError("pedido de más de 200 renglones", sell(ownerA.db, { ...priced(599), items: Array.from({ length: 201 }, (_, i) => item(pA, `${vkA}${i}`, 1)) }), /hasta 200 renglones/);
await expectError("cantidad no entera", sell(seller.db, priced(599, {}, 1.5)), /Cantidad inválida/);
await expectError("el nivel inexistente se rechaza", sell(seller.db, priced(480, { tierId: "fantasma" })), /Nivel de mayoreo inválido/);
const { data: oTier, error: oTierErr } = await sell(seller.db, priced(480, { tierId: "mayoreo" }, 6));
check("vendedor vende al precio exacto de un nivel de mayoreo", !oTierErr && oTier?.items?.[0]?.unitPrice === 480 && oTier.tier_id === "mayoreo", oTierErr?.message);
const { data: oEnc, error: oEncErr } = await sell(encargado.db, priced(599, { seller: "Falso" }));
check("el encargado vende como vendedor en el mostrador de su sucursal", !oEncErr && oEnc?.seller === "Eli", oEncErr?.message ?? oEnc?.seller);
await expectError("el encargado vende solo en su sucursal asignada", sell(encargado.db, { ...priced(599), branch: principalA.id }), /sucursal asignada/);
const { data: oFree, error: oFreeErr } = await sell(ownerA.db, priced(1, { seller: "Falso" }));
check("el dueño fija el precio libremente", !oFreeErr && oFree?.total === 1, oFreeErr?.message);
check("el dueño también queda con el nombre de su perfil como vendedor", oFree?.seller === "Dueña Alfa", oFree?.seller);

const { data: oFake } = await sell(seller.db, priced(599, { seller: "Falso" }));
check("un seller falso se reemplaza por el nombre del perfil", oFake?.seller === "Karla", oFake?.seller);
for (const status of ["cancelado", "pagado", "entregado"]) {
  const { data: o } = await sell(seller.db, priced(599, { payments: [], status }));
  check(`status '${status}' sin pago queda pendiente`, o?.status === "pendiente", o?.status);
}
const { data: oPartial } = await sell(seller.db, priced(599, { payments: [{ amount: 100, method: "efectivo" }], status: "pagado" }));
check("status 'pagado' con pago parcial queda apartado", oPartial?.status === "apartado", oPartial?.status);
const { data: oWeb } = await sell(seller.db, priced(599, { channel: "whatsapp", status: "entregado" }));
check("'entregado' fuera del mostrador se deriva de los pagos (pagado)", oWeb?.status === "pagado", oWeb?.status);
const { data: oPos, error: oPosErr } = await sell(seller.db, priced(599, { status: "entregado" }));
check("POS: venta de mostrador pagada con 'entregado' queda entregada", !oPosErr && oPos?.status === "entregado", oPosErr?.message ?? oPos?.status);

for (const [who, db] of [["vendedor", seller.db], ["dueño", ownerA.db]]) {
  await expectError(`${who}: unitPrice NaN se rechaza`, sell(db, priced("NaN", { payments: [] })), /Precio inválido/);
  await expectError(`${who}: descuento NaN se rechaza`, sell(db, priced(599, { discount: "NaN" })), /Descuento inválido/);
  await expectError(`${who}: envío NaN se rechaza`, sell(db, priced(599, { shipping: "NaN" })), /Envío inválido/);
  await expectError(`${who}: monto de pago NaN se rechaza`, sell(db, priced(599, { payments: [{ amount: "NaN", method: "efectivo" }] })), /Monto de pago inválido/);
}

// Conversión de cotizaciones: la regla del precio también vale ahí (sale del nivel guardado, no de la cotización)
// Solo el dueño puede guardar una cotización bajo el piso del nivel; el vendedor la convertiría con el precio de ese renglón.
const { data: qLow } = await ownerA.db.rpc("save_quote", { p: quoteOf(custA, pA, vkA, 469, "mayoreo") });
await expectError("vendedor no convierte una cotización con precio menor al de su nivel", seller.db.rpc("convert_quote", { p_quote: qLow.id, p_deposit: {} }), MIN_MSG);
const { data: qLowStill } = await ownerA.db.from("quotes").select("status").eq("id", qLow.id).single();
check("la conversión rechazada deja la cotización sin convertir", qLowStill?.status === "enviada", qLowStill?.status);
const { data: convLow, error: convLowErr } = await ownerA.db.rpc("convert_quote", { p_quote: qLow.id, p_deposit: {} });
check("el dueño sí convierte esa cotización", !convLowErr && convLow?.channel === "mayoreo" && convLow.total === 12 * 469 + 280, convLowErr?.message);

report();
