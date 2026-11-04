import { describe, expect, it } from "vitest";
import { canEnter, lastMonthsRange, monthlyRows, nextPayment, peakLabel, stateLabel, sumBy } from "@/lib/owner";

const NOW = new Date(2026, 9, 27, 12); // 27 oct 2026

describe("monthlyRows", () => {
  const byMonth = [
    { businessId: "a", month: "2026-10-01", revenue: 100, cogs: 40, expenses: 20 },
    { businessId: "b", month: "2026-10-01", revenue: 50, cogs: 10, expenses: 5 },
    { businessId: "a", month: "2026-08-01", revenue: 70, cogs: 30, expenses: 0 },
  ];

  it("rellena los meses sin movimiento y marca el actual como parcial", () => {
    const rows = monthlyRows(byMonth, 4, null, NOW);
    expect(rows.map((r) => r.key)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(rows.map((r) => r.ingresos)).toEqual([0, 70, 0, 150]);
    expect(rows.map((r) => r.partial)).toEqual([false, false, false, true]);
    expect(rows[3]).toMatchObject({ costo: 50, gastos: 25, utilidad: 75, margen: 0.5 });
    expect(rows[0].margen).toBe(0);
  });

  it("filtra por negocio", () => {
    expect(monthlyRows(byMonth, 1, ["b"], NOW)[0]).toMatchObject({ ingresos: 50, utilidad: 35 });
  });

  it("cruza el cambio de año", () => {
    const rows = monthlyRows([], 3, null, new Date(2026, 0, 15));
    expect(rows.map((r) => r.key)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01"]);
  });
});

describe("lastMonthsRange", () => {
  it("va del primer día de hace n-1 meses al primer día del mes siguiente", () => {
    const { from, to } = lastMonthsRange(6, NOW);
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 4, 1]);
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2026, 10, 1]);
  });
});

describe("sumBy", () => {
  it("suma por clave, ordena de mayor a menor y respeta el filtro", () => {
    const rows = [
      { businessId: "a", method: "tarjeta", amount: 10 },
      { businessId: "a", method: "efectivo", amount: 30 },
      { businessId: "b", method: "tarjeta", amount: 40 },
    ];
    expect(sumBy(rows, "method", null)).toEqual([
      { key: "tarjeta", amount: 50 },
      { key: "efectivo", amount: 30 },
    ]);
    expect(sumBy(rows, "method", ["a"])).toEqual([
      { key: "efectivo", amount: 30 },
      { key: "tarjeta", amount: 10 },
    ]);
  });
});

describe("membresías", () => {
  const prices = { priceMonthly: 1199, priceSetup: 3599 };

  it("el primer pago incluye el alta; en revisión o rechazado no hay pago", () => {
    expect(nextPayment({ state: "prueba", paidUntil: null }, prices)).toBe(4798);
    expect(nextPayment({ state: "activa", paidUntil: "2026-11-25T00:00:00Z" }, prices)).toBe(1199);
    expect(nextPayment({ state: "revision", paidUntil: null }, prices)).toBeNull();
    expect(nextPayment({ state: "rechazada", paidUntil: null }, prices)).toBeNull();
  });

  it("solo se entra a negocios que ya pasaron la revisión", () => {
    expect(canEnter({ state: "prueba" })).toBe(true);
    expect(canEnter({ state: "vencida" })).toBe(true);
    expect(canEnter({ state: "revision" })).toBe(false);
    expect(canEnter({ state: "rechazada" })).toBe(false);
  });

  it("stateLabel agrega los días de la prueba y la gracia", () => {
    expect(stateLabel("prueba", "2026-11-05T12:00:00", NOW)).toBe("Prueba · 9 días");
    expect(stateLabel("gracia", "2026-10-28T12:00:00", NOW)).toBe("En gracia · 1 día");
    expect(stateLabel("activa", "2026-11-05T12:00:00", NOW)).toBe("Activa");
  });
});

describe("peakLabel", () => {
  it("formatea día y franja de dos horas", () => {
    expect(peakLabel({ dow: 6, hour: 17 })).toBe("Sáb 17–19 h");
    expect(peakLabel({ dow: 1, hour: 23 })).toBe("Lun 23–1 h");
    expect(peakLabel(null)).toBe("—");
  });
});
