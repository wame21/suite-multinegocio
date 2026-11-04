import { daysLeft, STATE_LABELS } from "./membership";
import type { BusinessKind, MembershipState, OwnerBusiness, PaymentDetails } from "./types";

/** Respuesta de `owner_overview()`: ventas y gastos de los negocios del dueño en un rango. */
export interface Totals {
  revenue: number;
  cogs: number;
  expenses: number;
  fees: number;
  profit: number;
  orders: number;
}

export interface OverviewBusiness extends Totals {
  id: string;
  name: string;
  kind: BusinessKind;
  prevRevenue: number;
  /** `dow` 0 = domingo. */
  peakHour: { dow: number; hour: number } | null;
}

export interface Overview {
  totals: Totals;
  previous: Totals;
  businesses: OverviewBusiness[];
  byMonth: { businessId: string; month: string; revenue: number; cogs: number; expenses: number }[];
  paymentMethods: { businessId: string; method: string; amount: number }[];
  expenseCategories: { businessId: string; category: string; amount: number }[];
  bestDay: { day: string; revenue: number } | null;
}

/** Fila de `my_memberships().businesses`. */
export interface MembershipRow {
  id: string;
  name: string;
  kind: BusinessKind;
  state: MembershipState;
  endsAt: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  suspendedReason: string | null;
  lastPayment: { at: string; amount: number; note: string | null } | null;
}

export interface Memberships {
  priceMonthly: number;
  priceSetup: number;
  payment: PaymentDetails;
  businesses: MembershipRow[];
}

/** Estado con los días que quedan de la prueba o la gracia ("Prueba · 9 días"). */
export function stateLabel(state: MembershipState, endsAt: string | null, now = new Date()) {
  const days = state === "prueba" || state === "gracia" ? daysLeft(endsAt, now) : null;
  return days === null ? STATE_LABELS[state] : `${STATE_LABELS[state]} · ${days} ${days === 1 ? "día" : "días"}`;
}

/** Un negocio se puede abrir salvo que esté en revisión o rechazado (ahí no hay panel todavía). */
export const canEnter = (b: Pick<OwnerBusiness, "state">) => b.state !== "revision" && b.state !== "rechazada";

/** Lo que toca pagar: el primer pago incluye el alta. `null` mientras el negocio no está activado. */
export function nextPayment(row: Pick<MembershipRow, "state" | "paidUntil">, m: Pick<Memberships, "priceMonthly" | "priceSetup">) {
  if (row.state === "revision" || row.state === "rechazada") return null;
  return m.priceMonthly + (row.paidUntil ? 0 : m.priceSetup);
}

/** Rango [primer día del mes de hace `months - 1` meses, primer día del mes siguiente) para `owner_overview`. */
export function lastMonthsRange(months: number, now = new Date()) {
  return {
    from: new Date(now.getFullYear(), now.getMonth() - (months - 1), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/** Un mes por posición (los que no tienen movimiento valen 0), sumando solo los negocios de `ids` (todos si es `null`). */
export function monthlyRows(byMonth: Overview["byMonth"], months: number, ids: string[] | null, now = new Date()) {
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const rows = byMonth.filter((r) => r.month === key && (!ids || ids.includes(r.businessId)));
    const sum = (f: "revenue" | "cogs" | "expenses") => rows.reduce((a, r) => a + r[f], 0);
    const label = d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
    return {
      key,
      month: label.charAt(0).toUpperCase() + label.slice(1),
      partial: i === months - 1,
      ingresos: sum("revenue"),
      costo: sum("cogs"),
      gastos: sum("expenses"),
      utilidad: sum("revenue") - sum("cogs") - sum("expenses"),
      margen: sum("revenue") ? (sum("revenue") - sum("cogs") - sum("expenses")) / sum("revenue") : 0,
    };
  });
}

/** Suma de un grupo de filas `{ businessId, <clave>, amount }` por clave, de mayor a menor. */
export function sumBy<K extends string>(rows: ({ businessId: string; amount: number } & Record<K, string>)[], key: K, ids: string[] | null) {
  const map = new Map<string, number>();
  for (const r of rows) if (!ids || ids.includes(r.businessId)) map.set(r[key], (map.get(r[key]) ?? 0) + r.amount);
  return [...map].map(([k, amount]) => ({ key: k, amount })).sort((a, b) => b.amount - a.amount);
}

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "Sáb 17–19 h"; `null` sin ventas. */
export const peakLabel = (p: OverviewBusiness["peakHour"]) => (p ? `${DOW[p.dow]} ${p.hour}–${(p.hour + 2) % 24} h` : "—");
