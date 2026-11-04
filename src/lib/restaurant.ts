import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { ModifierGroup, PickedOption, PricedOption } from "./restaurant-pricing";

export type { ModifierGroup, ModifierOption, PickedOption, PricedOption } from "./restaurant-pricing";

// Capa de datos del restaurante. Contrato de la base en .design/contrato-bd.md.

export type PayMethod = "efectivo" | "tarjeta" | "transferencia";
export type TableOrderStatus = "por_pagar" | "pagado" | "en_preparacion" | "terminado" | "entregado" | "cancelado";

export interface DiningTable {
  id: string;
  name: string;
  area: string;
  /** Token del QR (`/m/[token]`). Cambia con `regenerateTableQr`. */
  qrToken: string;
  active: boolean;
  sort: number;
}

export interface MenuCategory {
  id: string;
  name: string;
  sort: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  photo: string | null;
  available: boolean;
  sort: number;
  modifiers: ModifierGroup[];
}

/** Renglón de un pedido: foto del precio y de las opciones al momento de pedir. */
export interface OrderLine {
  itemId: string;
  name: string;
  qty: number;
  basePrice: number;
  unitPrice: number;
  note: string | null;
  lineTotal: number;
  options: PricedOption[];
}

export interface TableOrder {
  id: string;
  tableId: string;
  folio: string;
  customerName: string;
  items: OrderLine[];
  note: string | null;
  total: number;
  paymentMethod: PayMethod;
  cardAtTable: boolean;
  status: TableOrderStatus;
  trackingToken: string;
  /** Marca de "Ya transferí": caja debe revisar el banco. */
  transferNoticeAt: string | null;
  createdAt: string;
  paidAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

export interface RestaurantSettings {
  /** Un mesero lleva la terminal a la mesa; si está apagado, la tarjeta se paga en caja. */
  cardAtTable: boolean;
  methods: PayMethod[];
  transfer: { bank: string; holder: string; clabe: string };
  folioPrefix: string;
  /** Mensaje de bienvenida del menú público (hasta 200 caracteres). */
  welcome?: string;
}

// ---------------------------------------------------------------------------
// Personal (sesión; lo que cada puesto puede hacer lo decide la base)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any -- filas de Supabase sin tipos generados */
const toTable = (r: any): DiningTable => ({ id: r.id, name: r.name, area: r.area, qrToken: r.qr_token, active: r.active, sort: r.sort });
const toCategory = (r: any): MenuCategory => ({ id: r.id, name: r.name, sort: r.sort });
const toItem = (r: any): MenuItem => ({
  id: r.id, categoryId: r.category_id, name: r.name, description: r.description, price: Number(r.price),
  photo: r.photo, available: r.available, sort: r.sort, modifiers: r.modifiers,
});
const toOrder = (r: any): TableOrder => ({
  id: r.id, tableId: r.table_id, folio: r.folio, customerName: r.customer_name, items: r.items, note: r.note,
  total: Number(r.total), paymentMethod: r.payment_method, cardAtTable: r.card_at_table, status: r.status,
  trackingToken: r.tracking_token, transferNoticeAt: r.transfer_notice_at, createdAt: r.created_at, paidAt: r.paid_at,
  preparingAt: r.preparing_at, readyAt: r.ready_at, deliveredAt: r.delivered_at, cancelledAt: r.cancelled_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

function must<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return r.data as NonNullable<T>;
}

export async function listTables(): Promise<DiningTable[]> {
  return must(await supabase().from("dining_tables").select("*").order("sort").order("name")).map(toTable);
}

export async function listMenu(): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
  const sb = supabase();
  const [c, i] = await Promise.all([
    sb.from("menu_categories").select("*").order("sort").order("name"),
    sb.from("menu_items").select("*").order("sort").order("name"),
  ]);
  return { categories: must(c).map(toCategory), items: must(i).map(toItem) };
}

/** Pedidos desde `since` (ISO); sin él, los de las últimas 24 horas. Más recientes primero. */
export async function listTableOrders(since = new Date(Date.now() - 864e5).toISOString()): Promise<TableOrder[]> {
  return must(await supabase().from("table_orders").select("*").gte("created_at", since).order("created_at", { ascending: false })).map(toOrder);
}

export async function getRestaurantSettings(): Promise<RestaurantSettings> {
  return must(await supabase().from("settings").select("value").eq("key", "restaurant").single()).value;
}

/** Cambia el estado de un pedido; la base valida puesto y transición (ver contrato). */
export async function setTableOrderStatus(id: string, status: TableOrderStatus): Promise<TableOrder> {
  return toOrder(must(await supabase().rpc("set_table_order_status", { p_id: id, p_status: status })));
}

/** Pedidos en vivo (INSERT y UPDATE). Devuelve la función para cancelar la suscripción. */
export function subscribeTableOrders(onChange: (order: TableOrder) => void): () => void {
  const sb = supabase();
  const channel = sb
    .channel(`table_orders:${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "table_orders" }, (p) => {
      if (p.eventType !== "DELETE") onChange(toOrder(p.new));
    })
    .subscribe();
  return () => void sb.removeChannel(channel);
}

// Solo dueño ---------------------------------------------------------------
export async function saveTable(t: Pick<DiningTable, "name" | "area" | "active" | "sort"> & { id?: string }): Promise<DiningTable> {
  // Solo las columnas editables: quien pasa la mesa completa ({ ...t }) trae qrToken y PostgREST lo rechaza.
  const { id, name, area, active, sort } = t;
  const fields = { name, area, active, sort };
  const q = id ? supabase().from("dining_tables").update(fields).eq("id", id) : supabase().from("dining_tables").insert(fields);
  const r = await q.select().single();
  if (r.error?.code === "23505") throw new Error("Ya existe una mesa con ese nombre");
  return toTable(must(r));
}

/** Borra la mesa (RLS: solo el dueño de un restaurante). Con pedidos la FK lo impide: ahí se desactiva. */
export async function deleteTable(id: string): Promise<void> {
  const { error } = await supabase().from("dining_tables").delete().eq("id", id);
  if (error?.code === "23503") throw new Error("Esta mesa ya tiene pedidos: desactívala en lugar de borrarla");
  if (error) throw new Error(error.message);
}

/** Invalida el QR impreso anterior. */
export async function regenerateTableQr(id: string): Promise<DiningTable> {
  return toTable(must(await supabase().rpc("regenerate_table_qr", { p_id: id })));
}

export async function saveCategory(c: Pick<MenuCategory, "name" | "sort"> & { id?: string }): Promise<MenuCategory> {
  const { id, ...fields } = c;
  const q = id ? supabase().from("menu_categories").update(fields).eq("id", id) : supabase().from("menu_categories").insert(fields);
  return toCategory(must(await q.select().single()));
}

/** Guarda el platillo y, si se da, su costo (que solo ve el dueño). */
export async function saveMenuItem(item: Omit<MenuItem, "id"> & { id?: string }, cost?: number): Promise<MenuItem> {
  const sb = supabase();
  const { id, categoryId, ...rest } = item;
  const fields = { ...rest, category_id: categoryId };
  const row = must(await (id ? sb.from("menu_items").update(fields).eq("id", id) : sb.from("menu_items").insert(fields)).select().single());
  if (cost !== undefined) must(await sb.from("menu_item_costs").upsert({ item_id: row.id, cost }).select());
  return toItem(row);
}

export async function getMenuItemCosts(): Promise<Record<string, number>> {
  const rows = must(await supabase().from("menu_item_costs").select("item_id, cost"));
  return Object.fromEntries(rows.map((r: { item_id: string; cost: number }) => [r.item_id, Number(r.cost)]));
}

export async function saveRestaurantSettings(value: RestaurantSettings): Promise<void> {
  must(await supabase().from("settings").update({ value }).eq("key", "restaurant").select());
}

// ---------------------------------------------------------------------------
// Comensal (anónimo; solo lectura de su mesa y su pedido)
// ---------------------------------------------------------------------------
export interface TableMenu {
  business: { name: string; logoUrl: string | null; accentColor: string | null; welcome: string | null };
  table: { name: string; area: string };
  cardAtTable: boolean;
  methods: PayMethod[];
  categories: { id: string; name: string; items: Omit<MenuItem, "categoryId" | "available" | "sort">[] }[];
}

export interface PlacedOrder {
  trackingToken: string;
  folio: string;
  status: TableOrderStatus;
  total: number;
  paymentMethod: PayMethod;
  cardAtTable: boolean;
}

export interface PublicOrderStatus {
  folio: string;
  status: TableOrderStatus;
  customerName: string;
  items: OrderLine[];
  note: string | null;
  total: number;
  paymentMethod: PayMethod;
  cardAtTable: boolean;
  transferNotified: boolean;
  table: string;
  business: string;
  /** Solo en pedidos por transferencia. */
  transfer: RestaurantSettings["transfer"] | null;
  createdAt: string;
  paidAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

/** Menú de la mesa del QR; `null` si el QR no es válido, la mesa está inactiva o el restaurante no opera. */
export async function fetchTableMenu(token: string): Promise<TableMenu | null> {
  return must(await supabase().rpc("table_menu", { p_token: token }));
}

/** Estado de un pedido por su token de seguimiento; `null` si no existe. Se consulta cada 5 s. */
export async function fetchOrderStatus(tracking: string): Promise<PublicOrderStatus | null> {
  return must(await supabase().rpc("table_order_status", { p_tracking: tracking }));
}

/** "Ya transferí": avisa a caja que revise el banco. No se sube comprobante. */
export async function notifyTransfer(tracking: string): Promise<void> {
  must(await supabase().rpc("table_order_transfer_notice", { p_tracking: tracking }));
}

/**
 * Crea el pedido por la Edge Function `table-order` (límite por IP). El servidor recalcula precios y
 * modificadores; `items` solo dice qué platillos, cuántos, su nota y qué opciones.
 * Lanza un Error con el mensaje en español de la base (mesa inactiva, opción agotada, demasiados intentos…).
 */
export async function placeTableOrder(input: {
  token: string;
  name: string;
  items: { itemId: string; qty: number; note?: string; options?: PickedOption[] }[];
  note?: string;
  method: PayMethod;
}): Promise<PlacedOrder> {
  const { data, error } = await supabase().functions.invoke<PlacedOrder>("table-order", { body: input });
  if (error) {
    const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
    throw new Error(body?.error ?? "No se pudo crear el pedido, intenta de nuevo");
  }
  return data!;
}
