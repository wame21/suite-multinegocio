import { inRange, type Range } from "./metrics";
import type { PayMethod } from "./restaurant";
import type { ExpenseCategory } from "./types";

// Métricas del restaurante. Un pedido cuenta como venta desde `paidAt` (pago confirmado; los cancelados nunca lo tienen),
// igual que `owner_overview`, y las horas/días usan la zona fija del contrato.
const ZONE = "America/Mexico_City";

export interface RestoOrder {
  tableId: string;
  total: number;
  /** Costo de insumos del pedido al crearlo (solo el dueño lo lee). */
  cost: number;
  paymentMethod: PayMethod;
  cardAtTable: boolean;
  paidAt: string;
  readyAt: string | null;
  items: { itemId: string; name: string; qty: number; lineTotal: number }[];
}

export interface RestoExpense {
  date: string;
  category: ExpenseCategory;
  amount: number;
}

export type Fees = Partial<Record<PayMethod, number>>;

const zoned = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(iso: string) {
  const p = Object.fromEntries(zoned.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), dow: DOW.indexOf(p.weekday) };
}

export const paidIn = (orders: RestoOrder[], r: Range) => orders.filter((o) => inRange(o.paidAt, r));

/** Estado de resultados: mismo cálculo que `owner_overview` (utilidad = ventas − insumos − gastos − comisiones). */
export function restoPnl(orders: RestoOrder[], expenses: RestoExpense[], fees: Fees, r: Range) {
  const paid = paidIn(orders, r);
  const revenue = paid.reduce((a, o) => a + o.total, 0);
  const cogs = paid.reduce((a, o) => a + o.cost, 0);
  const feeTotal = paid.reduce((a, o) => a + o.total * (fees[o.paymentMethod] ?? 0), 0);
  const byCat: Partial<Record<ExpenseCategory, number>> = {};
  for (const e of expenses) if (inRange(e.date, r)) byCat[e.category] = (byCat[e.category] ?? 0) + e.amount;
  const opex = Object.values(byCat).reduce((a, b) => a + b, 0);
  const operatingProfit = revenue - cogs - opex - feeTotal;
  return {
    orders: paid.length,
    revenue,
    cogs,
    fees: feeTotal,
    byCat,
    opex,
    operatingProfit,
    operatingMargin: revenue ? operatingProfit / revenue : 0,
  };
}

export type PayChannel = "efectivo" | "tarjeta_mesa" | "tarjeta_caja" | "transferencia";

const channelOf = (o: Pick<RestoOrder, "paymentMethod" | "cardAtTable">): PayChannel =>
  o.paymentMethod !== "tarjeta" ? o.paymentMethod : o.cardAtTable ? "tarjeta_mesa" : "tarjeta_caja";

/** Ingresos por método; la tarjeta se separa según se cobre en la mesa o en caja. Mayor primero, sin los de $0. */
export function revenueByChannel(orders: RestoOrder[], r: Range) {
  const sums = new Map<PayChannel, number>();
  for (const o of paidIn(orders, r)) sums.set(channelOf(o), (sums.get(channelOf(o)) ?? 0) + o.total);
  return [...sums.entries()].map(([channel, amount]) => ({ channel, amount })).sort((a, b) => b.amount - a.amount);
}

export interface CashCutRow {
  day: string;
  orders: number;
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  total: number;
}

/** Corte de caja: lo cobrado cada día por método. Día más reciente primero. */
export function dailyCut(orders: RestoOrder[], r: Range): CashCutRow[] {
  const days = new Map<string, CashCutRow>();
  for (const o of paidIn(orders, r)) {
    const day = localParts(o.paidAt).day;
    const row = days.get(day) ?? { day, orders: 0, efectivo: 0, tarjeta: 0, transferencia: 0, total: 0 };
    row.orders += 1;
    row[o.paymentMethod] += o.total;
    row.total += o.total;
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** Platillos más pedidos (por piezas) con lo que dejaron. */
export function topItems(orders: RestoOrder[], r: Range, limit = 8) {
  const items = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const o of paidIn(orders, r))
    for (const it of o.items) {
      const row = items.get(it.itemId) ?? { name: it.name, qty: 0, revenue: 0 };
      row.qty += it.qty;
      row.revenue += it.lineTotal;
      items.set(it.itemId, row);
    }
  return [...items.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, limit);
}

/** Dos horas seguidas con más pedidos (`from` a `to`), o `null` si no hubo ninguno. */
function bestWindow(counts: number[]) {
  let best: { from: number; count: number } | null = null;
  for (let h = 0; h < 23; h++) {
    const count = counts[h] + counts[h + 1];
    if (count > (best?.count ?? 0)) best = { from: h, count };
  }
  return best && { from: best.from, to: best.from + 2 };
}

/** Pedidos por hora del día y la ventana pico entre semana y en fin de semana. */
export function peakHours(orders: RestoOrder[], r: Range) {
  const all = Array<number>(24).fill(0);
  const weekday = Array<number>(24).fill(0);
  const weekend = Array<number>(24).fill(0);
  for (const o of paidIn(orders, r)) {
    const { hour, dow } = localParts(o.paidAt);
    all[hour] += 1;
    (dow === 0 || dow === 6 ? weekend : weekday)[hour] += 1;
  }
  return { byHour: all, weekday: bestWindow(weekday), weekend: bestWindow(weekend) };
}

export const SLOW_MINUTES = 15;

/**
 * Minutos del pago a terminado. Por categoría, el pedido cuenta en cada categoría que lleva
 * (shortcut: un pedido mixto suma su tiempo completo a todas; afinar si hace falta por estación).
 */
export function prepTimes(orders: RestoOrder[], r: Range, categoryOf: (itemId: string) => string | undefined) {
  const times = paidIn(orders, r)
    .filter((o) => o.readyAt)
    .map((o) => ({ o, min: (new Date(o.readyAt!).getTime() - new Date(o.paidAt).getTime()) / 60_000 }))
    .filter((t) => t.min >= 0);
  const cats = new Map<string, number[]>();
  for (const { o, min } of times)
    for (const c of new Set(o.items.map((it) => categoryOf(it.itemId)))) if (c) cats.set(c, [...(cats.get(c) ?? []), min]);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    orders: times.length,
    average: times.length ? avg(times.map((t) => t.min)) : null,
    slowShare: times.length ? times.filter((t) => t.min > SLOW_MINUTES).length / times.length : 0,
    byCategory: [...cats.entries()].map(([category, xs]) => ({ category, minutes: avg(xs) })).sort((a, b) => b.minutes - a.minutes),
  };
}

/** Ventas por mesa (mayor primero) y por área, con las mesas que tiene cada área. */
export function salesByTable(orders: RestoOrder[], r: Range, tables: { id: string; name: string; area: string }[]) {
  const paid = paidIn(orders, r);
  const rows = tables
    .map((t) => {
      const mine = paid.filter((o) => o.tableId === t.id);
      return { id: t.id, name: t.name, area: t.area, orders: mine.length, revenue: mine.reduce((a, o) => a + o.total, 0) };
    })
    .filter((t) => t.orders > 0)
    .sort((a, b) => b.revenue - a.revenue);
  const areas = new Map<string, { area: string; revenue: number; tables: number }>();
  for (const t of tables) areas.set(t.area, { area: t.area, revenue: 0, tables: (areas.get(t.area)?.tables ?? 0) + 1 });
  for (const t of rows) areas.get(t.area)!.revenue += t.revenue;
  return {
    total: paid.reduce((a, o) => a + o.total, 0),
    rows,
    areas: [...areas.values()].filter((a) => a.revenue > 0).sort((a, b) => b.revenue - a.revenue),
  };
}
