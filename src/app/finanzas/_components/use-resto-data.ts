"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Fees, RestoExpense, RestoOrder } from "@/lib/metrics-restaurante";
import { listMenu, listTables, type DiningTable } from "@/lib/restaurant";
import { errorMessage } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";

export interface RestoData {
  orders: RestoOrder[];
  expenses: RestoExpense[];
  fees: Fees;
  tables: DiningTable[];
  /** Nombre de la categoría del menú de cada platillo. */
  categoryOf: (itemId: string) => string | undefined;
}

const PAGE = 1000;
/* eslint-disable @typescript-eslint/no-explicit-any -- filas de Supabase sin tipos generados */
type Rows = PromiseLike<{ data: any[] | null; error: { message: string } | null }>;

/** PostgREST corta en 1000 filas: pide por páginas hasta agotar. */
async function fetchAll(query: (a: number, b: number) => Rows) {
  const rows: any[] = [];
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await query(a, a + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data!);
    if (data!.length < PAGE) return rows;
  }
}

/** Ventas con pago confirmado, gastos, comisiones, mesas y menú del negocio activo (el estado de resultados es solo del dueño). */
async function fetchResto(from: string, to: string): Promise<RestoData> {
  const sb = supabase();
  const [orders, expenses, settings, tables, menu] = await Promise.all([
    fetchAll((a, b) =>
      sb
        .from("table_orders")
        .select("id, table_id, total, payment_method, card_at_table, items, paid_at, ready_at")
        .not("paid_at", "is", null)
        .gte("paid_at", from)
        .lte("paid_at", to)
        .order("paid_at")
        .order("id")
        .range(a, b),
    ),
    fetchAll((a, b) => sb.from("expenses").select("date, category, amount").gte("date", from).lte("date", to).order("date").order("id").range(a, b)),
    sb.from("settings").select("value").eq("key", "sales").maybeSingle(),
    listTables(),
    listMenu(),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  // El costo de cada pedido vive en otra tabla: se pide por tandas para no pasar de largo la URL.
  const costs = new Map<string, number>();
  const ids = orders.map((o) => o.id as string);
  const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100));
  for (const rows of await Promise.all(chunks.map((c) => fetchAll((a, b) => sb.from("table_order_costs").select("order_id, cost").in("order_id", c).range(a, b)))))
    for (const r of rows) costs.set(r.order_id, Number(r.cost));
  const categoryName = new Map(menu.categories.map((c) => [c.id, c.name]));
  const itemCategory = new Map(menu.items.map((i) => [i.id, categoryName.get(i.categoryId)]));
  return {
    orders: orders.map((o) => ({
      tableId: o.table_id,
      total: Number(o.total),
      cost: costs.get(o.id) ?? 0,
      paymentMethod: o.payment_method,
      cardAtTable: o.card_at_table,
      paidAt: o.paid_at,
      readyAt: o.ready_at,
      items: o.items,
    })),
    expenses: expenses.map((e) => ({ date: e.date, category: e.category, amount: Number(e.amount) })),
    fees: settings.data?.value?.paymentFees ?? {},
    tables,
    categoryOf: (itemId) => itemCategory.get(itemId),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Datos del restaurante pagados en [from, to]; `null` mientras carga. `reload` los vuelve a pedir (p. ej. tras registrar un gasto). */
export function useRestoData(from: Date, to: Date) {
  const [version, setVersion] = useState(0);
  const key = `${from.getTime()}|${to.getTime()}|${version}`;
  const [loaded, setLoaded] = useState<{ key: string; data: RestoData } | null>(null);
  useEffect(() => {
    let live = true;
    const [a, b] = key.split("|").map((ms) => new Date(Number(ms)).toISOString());
    fetchResto(a, b)
      .then((data) => live && setLoaded({ key, data }))
      .catch((e) => live && toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [key]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Al recargar con el mismo rango se conservan los datos anteriores; al cambiar de rango, no.
  const data = loaded?.key.startsWith(`${from.getTime()}|${to.getTime()}|`) ? loaded.data : null;
  return { data, reload };
}
