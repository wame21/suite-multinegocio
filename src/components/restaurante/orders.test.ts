import { describe, expect, it } from "vitest";
import type { DiningTable, TableOrder } from "@/lib/restaurant";
import { dayStats, groupByStatus, mergeOrders, tableState, upsertOrder } from "./orders";

const order = (id: string, patch: Partial<TableOrder> = {}): TableOrder => ({
  id, tableId: "t1", folio: `A-${id}`, customerName: "Ana", items: [], note: null, total: 100, paymentMethod: "efectivo",
  cardAtTable: false, status: "por_pagar", trackingToken: id, transferNoticeAt: null, createdAt: `2026-11-01T10:0${id}:00`,
  paidAt: null, preparingAt: null, readyAt: null, deliveredAt: null, cancelledAt: null, ...patch,
});
const line = (name: string, qty: number) => ({ itemId: name, name, qty, basePrice: 10, unitPrice: 10, note: null, lineTotal: 10 * qty, options: [] });
const table = (id: string, active = true): DiningTable => ({ id, name: id, area: "Salón", qrToken: id, active, sort: 0 });

describe("pedidos en vivo", () => {
  it("agrupa por estado con el más antiguo primero", () => {
    const g = groupByStatus([order("3"), order("1"), order("2", { status: "pagado" })]);
    expect(g.por_pagar.map((o) => o.id)).toEqual(["1", "3"]);
    expect(g.pagado).toHaveLength(1);
    expect(g.cancelado).toEqual([]);
  });

  it("upsert reemplaza el pedido existente o lo agrega al frente", () => {
    const list = [order("1"), order("2")];
    expect(upsertOrder(list, order("2", { status: "pagado" })).map((o) => o.status)).toEqual(["por_pagar", "pagado"]);
    expect(upsertOrder(list, order("3")).map((o) => o.id)).toEqual(["3", "1", "2"]);
  });

  it("merge conserva lo recibido en vivo sobre la lectura inicial", () => {
    const merged = mergeOrders([order("1"), order("2")], [order("2", { status: "pagado" })]);
    expect(merged.map((o) => `${o.id}:${o.status}`)).toEqual(["2:pagado", "1:por_pagar"]);
  });

  it("estado de mesa: lo que pide acción gana", () => {
    expect(tableState([])).toBe("libre");
    expect(tableState([order("1")])).toBe("cobrar");
    expect(tableState([order("1"), order("2", { cardAtTable: true })])).toBe("terminal");
    expect(tableState([order("1", { status: "en_preparacion" })])).toBe("cocina");
    expect(tableState([order("1", { status: "en_preparacion" }), order("2", { status: "terminado" })])).toBe("listo");
  });
});

describe("panel de hoy", () => {
  const now = new Date("2026-11-01T15:00:00");
  const paid = (id: string, paidAt: string, total: number, extra: Partial<TableOrder> = {}) =>
    order(id, { status: "entregado", paidAt, total, deliveredAt: paidAt, ...extra });

  it("suma solo lo cobrado hoy, ticket promedio, horas y más pedidos", () => {
    const s = dayStats(
      [
        paid("1", "2026-11-01T09:10:00", 200, { items: [line("Latte", 2), line("Pan", 1)] }),
        paid("2", "2026-11-01T09:40:00", 100, { items: [line("Latte", 1)] }),
        paid("3", "2026-10-31T09:10:00", 999), // ayer
        order("4", { status: "cancelado", cancelledAt: "2026-11-01T11:00:00" }),
      ],
      [],
      now,
    );
    expect(s.sales).toBe(300);
    expect(s.paidCount).toBe(2);
    expect(s.ticket).toBe(150);
    expect(s.byHour).toEqual({ 9: 300 });
    expect(s.top[0]).toEqual(["Latte", 3]);
    expect(s.counts.entregado).toBe(2);
    expect(s.counts.cancelado).toBe(1);
  });

  it("promedio de preparación y mesas ocupadas (solo mesas activas)", () => {
    const s = dayStats(
      [
        order("1", { status: "terminado", paidAt: "2026-11-01T10:00:00", preparingAt: "2026-11-01T10:01:00", readyAt: "2026-11-01T10:11:00" }),
        order("2", { tableId: "t2", status: "pagado", paidAt: "2026-11-01T10:05:00" }),
        order("3", { tableId: "t3", status: "pagado", paidAt: "2026-11-01T10:06:00" }), // mesa desactivada
      ],
      [table("t1"), table("t2"), table("t3", false)],
      now,
    );
    expect(s.prepAvg).toBe(10);
    expect(s.occupied).toBe(2);
    expect(s.activeTables).toBe(2);
    expect(s.counts.pagado).toBe(2);
  });

  it("sin pedidos no divide entre cero", () => {
    const s = dayStats([], [], now);
    expect([s.sales, s.ticket, s.prepAvg]).toEqual([0, 0, null]);
  });
});
