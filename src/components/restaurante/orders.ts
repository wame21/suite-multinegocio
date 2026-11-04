import type { DiningTable, PayMethod, TableOrder, TableOrderStatus } from "@/lib/restaurant";

export const STATUS_NAME: Record<TableOrderStatus, string> = {
  por_pagar: "Por cobrar",
  pagado: "Pagado",
  en_preparacion: "En preparación",
  terminado: "Terminado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const METHOD_NAME: Record<PayMethod, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };

const OPEN: TableOrderStatus[] = ["por_pagar", "pagado", "en_preparacion", "terminado"];
export const isOpen = (o: TableOrder) => OPEN.includes(o.status);

/** Pedido nuevo o cambiado (realtime / respuesta de la RPC): reemplaza el existente o entra al frente. */
export const upsertOrder = (list: TableOrder[], o: TableOrder) =>
  list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [o, ...list];

/** Carga inicial + eventos que llegaron mientras cargaba: lo que ya llegó por realtime es más nuevo que la lectura. */
export function mergeOrders(fetched: TableOrder[], live: TableOrder[]) {
  const ids = new Set(live.map((o) => o.id));
  return [...live, ...fetched.filter((o) => !ids.has(o.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pedidos por estado, el más antiguo primero (el que lleva más esperando). */
export function groupByStatus(orders: TableOrder[]) {
  const groups: Record<TableOrderStatus, TableOrder[]> = { por_pagar: [], pagado: [], en_preparacion: [], terminado: [], entregado: [], cancelado: [] };
  for (const o of [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) groups[o.status].push(o);
  return groups;
}

export const minutesSince = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

/** Desde cuándo está el pedido en su estado actual. */
export const stageSince = (o: TableOrder) =>
  (o.status === "pagado" ? o.paidAt : o.status === "en_preparacion" ? o.preparingAt : o.status === "terminado" ? o.readyAt : null) ?? o.createdAt;

export const agoLabel = (minutes: number) => (minutes < 1 ? "hace un momento" : minutes < 60 ? `hace ${minutes} min` : `hace ${Math.floor(minutes / 60)} h`);

export type TableState = "libre" | "cobrar" | "terminal" | "cocina" | "listo";

/** Estado de una mesa según sus pedidos abiertos; manda lo que requiere acción del personal. */
export function tableState(open: TableOrder[]): TableState {
  if (open.some((o) => o.status === "terminado")) return "listo";
  if (open.some((o) => o.status === "por_pagar" && o.cardAtTable)) return "terminal";
  if (open.some((o) => o.status === "por_pagar")) return "cobrar";
  return open.length ? "cocina" : "libre";
}

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/** Cifras del panel de hoy (día local) a partir de los pedidos cargados. */
export function dayStats(orders: TableOrder[], tables: DiningTable[], now: Date) {
  const from = startOfDay(now);
  const today = (iso: string | null) => !!iso && Date.parse(iso) >= from;
  const paid = orders.filter((o) => today(o.paidAt));
  const sales = paid.reduce((s, o) => s + o.total, 0);

  const byHour: Record<number, number> = {};
  for (const o of paid) byHour[new Date(o.paidAt!).getHours()] = (byHour[new Date(o.paidAt!).getHours()] ?? 0) + o.total;

  const qty = new Map<string, number>();
  for (const o of paid) for (const l of o.items) qty.set(l.name, (qty.get(l.name) ?? 0) + l.qty);

  const preps = orders.filter((o) => today(o.readyAt) && o.preparingAt && o.readyAt).map((o) => (Date.parse(o.readyAt!) - Date.parse(o.preparingAt!)) / 60_000);
  const groups = groupByStatus(orders.filter(isOpen));
  const active = new Set(tables.filter((t) => t.active).map((t) => t.id));

  return {
    sales,
    paidCount: paid.length,
    ticket: paid.length ? sales / paid.length : 0,
    byHour,
    top: [...qty].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5),
    prepAvg: preps.length ? preps.reduce((s, m) => s + m, 0) / preps.length : null,
    counts: {
      por_pagar: groups.por_pagar.length,
      pagado: groups.pagado.length,
      en_preparacion: groups.en_preparacion.length,
      terminado: groups.terminado.length,
      entregado: orders.filter((o) => o.status === "entregado" && today(o.deliveredAt)).length,
      cancelado: orders.filter((o) => o.status === "cancelado" && today(o.cancelledAt)).length,
    },
    oldestPrep: groups.en_preparacion[0]?.preparingAt ?? null,
    occupied: new Set(orders.filter((o) => isOpen(o) && active.has(o.tableId)).map((o) => o.tableId)).size,
    activeTables: active.size,
  };
}
