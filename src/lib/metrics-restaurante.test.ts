import { describe, expect, it } from "vitest";
import {
  dailyCut,
  peakHours,
  prepTimes,
  restoPnl,
  revenueByChannel,
  salesByTable,
  topItems,
  type RestoExpense,
  type RestoOrder,
} from "./metrics-restaurante";

// México es UTC−6: 16:30Z = 10:30 h. El 26 oct 2026 es lunes; el 24, sábado.
const R = { from: new Date("2026-10-01T06:00:00Z"), to: new Date("2026-11-01T05:59:59Z") };
const order = (o: Partial<RestoOrder>): RestoOrder => ({
  tableId: "t1",
  total: 100,
  cost: 30,
  paymentMethod: "efectivo",
  cardAtTable: false,
  paidAt: "2026-10-26T16:30:00Z",
  readyAt: null,
  items: [{ itemId: "cafe", name: "Café", qty: 1, lineTotal: 100 }],
  ...o,
});

describe("restoPnl", () => {
  const orders = [
    order({}),
    order({ total: 200, cost: 50, paymentMethod: "tarjeta" }),
    order({ paidAt: "2026-09-30T16:00:00Z", total: 999 }), // fuera del periodo
  ];
  const expenses: RestoExpense[] = [
    { date: "2026-10-05T18:00:00Z", category: "renta", amount: 40 },
    { date: "2026-10-06T18:00:00Z", category: "renta", amount: 10 },
    { date: "2026-09-05T18:00:00Z", category: "nomina", amount: 500 },
  ];

  it("suma ventas, insumos, gastos y comisiones del periodo", () => {
    const p = restoPnl(orders, expenses, { tarjeta: 0.1 }, R);
    expect(p).toMatchObject({ orders: 2, revenue: 300, cogs: 80, opex: 50, byCat: { renta: 50 } });
    expect(p.fees).toBeCloseTo(20);
    expect(p.operatingProfit).toBeCloseTo(300 - 80 - 50 - 20);
    expect(p.operatingMargin).toBeCloseTo(150 / 300);
  });

  it("sin ventas el margen es 0, no NaN", () => {
    expect(restoPnl([], [], {}, R).operatingMargin).toBe(0);
  });
});

describe("revenueByChannel", () => {
  it("separa la tarjeta en mesa y en caja y ordena de mayor a menor", () => {
    const r = revenueByChannel(
      [
        order({ total: 50 }),
        order({ total: 70, paymentMethod: "tarjeta", cardAtTable: true }),
        order({ total: 30, paymentMethod: "tarjeta" }),
        order({ total: 40, paymentMethod: "tarjeta", cardAtTable: true }),
      ],
      R,
    );
    expect(r).toEqual([
      { channel: "tarjeta_mesa", amount: 110 },
      { channel: "efectivo", amount: 50 },
      { channel: "tarjeta_caja", amount: 30 },
    ]);
  });
});

describe("dailyCut", () => {
  it("agrupa por día local (23:30 h del día 25 no pasa al 26) y ordena del más reciente", () => {
    const rows = dailyCut(
      [
        order({ paidAt: "2026-10-26T05:30:00Z", total: 10 }), // 25 oct, 23:30 h
        order({ paidAt: "2026-10-26T17:00:00Z", total: 20, paymentMethod: "transferencia" }),
        order({ paidAt: "2026-10-26T18:00:00Z", total: 30, paymentMethod: "tarjeta" }),
      ],
      R,
    );
    expect(rows).toEqual([
      { day: "2026-10-26", orders: 2, efectivo: 0, tarjeta: 30, transferencia: 20, total: 50 },
      { day: "2026-10-25", orders: 1, efectivo: 10, tarjeta: 0, transferencia: 0, total: 10 },
    ]);
  });
});

describe("topItems", () => {
  it("ordena por piezas y respeta el límite", () => {
    const line = (itemId: string, qty: number, lineTotal: number) => ({ itemId, name: itemId, qty, lineTotal });
    const orders = [order({ items: [line("a", 1, 50), line("b", 3, 90)] }), order({ items: [line("a", 1, 50), line("c", 1, 10)] })];
    expect(topItems(orders, R).map((i) => [i.name, i.qty, i.revenue])).toEqual([
      ["b", 3, 90],
      ["a", 2, 100],
      ["c", 1, 10],
    ]);
    expect(topItems(orders, R, 1)).toHaveLength(1);
  });
});

describe("peakHours", () => {
  it("cuenta por hora local y da la ventana pico entre semana y en fin de semana", () => {
    const p = peakHours(
      [
        order({ paidAt: "2026-10-26T14:10:00Z" }), // lun 8:10
        order({ paidAt: "2026-10-26T15:20:00Z" }), // lun 9:20
        order({ paidAt: "2026-10-27T14:40:00Z" }), // mar 8:40
        order({ paidAt: "2026-10-24T16:05:00Z" }), // sáb 10:05
        order({ paidAt: "2026-10-25T17:30:00Z" }), // dom 11:30
      ],
      R,
    );
    expect(p.byHour[8]).toBe(2);
    expect(p.weekday).toEqual({ from: 8, to: 10 });
    expect(p.weekend).toEqual({ from: 10, to: 12 });
  });

  it("sin pedidos no hay pico", () => {
    expect(peakHours([], R)).toMatchObject({ weekday: null, weekend: null });
  });
});

describe("prepTimes", () => {
  const cat = (id: string) => ({ cafe: "Cafés", pan: "Panadería" })[id as "cafe" | "pan"];
  const ready = (min: number, items = ["cafe"]) =>
    order({
      readyAt: new Date(new Date("2026-10-26T16:30:00Z").getTime() + min * 60_000).toISOString(),
      items: items.map((itemId) => ({ itemId, name: itemId, qty: 1, lineTotal: 10 })),
    });

  it("promedia del pago a terminado, por categoría, y cuenta los lentos", () => {
    const t = prepTimes([ready(4), ready(6), ready(20, ["cafe", "pan"]), order({})], R, cat);
    expect(t.orders).toBe(3); // el que no está terminado no cuenta
    expect(t.average).toBeCloseTo(10);
    expect(t.slowShare).toBeCloseTo(1 / 3);
    expect(t.byCategory).toEqual([
      { category: "Panadería", minutes: 20 },
      { category: "Cafés", minutes: 10 },
    ]);
  });

  it("sin pedidos terminados no hay promedio", () => {
    expect(prepTimes([order({})], R, cat)).toMatchObject({ orders: 0, average: null, slowShare: 0 });
  });
});

describe("salesByTable", () => {
  const tables = [
    { id: "t1", name: "Mesa 1", area: "Terraza" },
    { id: "t2", name: "Mesa 2", area: "Salón" },
    { id: "t3", name: "Mesa 3", area: "Terraza" },
    { id: "t4", name: "Mesa 4", area: "Salón" },
  ];

  it("ordena mesas y áreas por venta y omite las que no vendieron", () => {
    const s = salesByTable(
      [order({ tableId: "t1", total: 50 }), order({ tableId: "t3", total: 70 }), order({ tableId: "t2", total: 30 })],
      R,
      tables,
    );
    expect(s.total).toBe(150);
    expect(s.rows.map((t) => t.name)).toEqual(["Mesa 3", "Mesa 1", "Mesa 2"]);
    expect(s.areas).toEqual([
      { area: "Terraza", revenue: 120, tables: 2 },
      { area: "Salón", revenue: 30, tables: 2 },
    ]);
  });
});
