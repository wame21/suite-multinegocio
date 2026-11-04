import { describe, expect, it } from "vitest";
import { type ModifierGroup, orderTotal, priceLine } from "@/lib/restaurant-pricing";

// Mismo menú que se usó para probar place_table_order en la base.
const leche: ModifierGroup = {
  id: "g1", nombre: "Leche", obligatorio: true, min: 1, max: 1,
  opciones: [
    { id: "o1", nombre: "Entera", precio_extra: 0, disponible: true },
    { id: "o2", nombre: "Almendra", precio_extra: 10, disponible: true },
    { id: "o3", nombre: "Avena", precio_extra: 10, disponible: false },
  ],
};
const extras: ModifierGroup = {
  id: "g2", nombre: "Extras", obligatorio: false, min: 0, max: 2,
  opciones: [
    { id: "e1", nombre: "Shot", precio_extra: 5, disponible: true },
    { id: "e2", nombre: "Vainilla", precio_extra: 8, disponible: true },
    { id: "e3", nombre: "Crema", precio_extra: 12.5, disponible: true },
  ],
};
const latte = { name: "Latte", price: 50, modifiers: [leche, extras] };
const pick = (groupId: string, optionId: string) => ({ groupId, optionId });

describe("priceLine", () => {
  it("suma los extras al precio y multiplica por la cantidad", () => {
    const r = priceLine(latte, [pick("g1", "o2"), pick("g2", "e1"), pick("g2", "e2")], 2);
    expect(r.unitPrice).toBe(73);
    expect(r.lineTotal).toBe(146);
    expect(r.options.map((o) => o.name)).toEqual(["Almendra", "Shot", "Vainilla"]);
  });

  it("un platillo sin modificadores cuesta su precio", () => {
    expect(priceLine({ price: 20, modifiers: [] }, [], 3).lineTotal).toBe(60);
  });

  it("redondea a centavos", () => {
    expect(priceLine(latte, [pick("g1", "o1"), pick("g2", "e3")], 3).lineTotal).toBe(187.5);
  });

  it("rechaza un grupo obligatorio sin elegir y más del máximo", () => {
    expect(() => priceLine(latte, [], 1)).toThrow('Elige entre 1 y 1 opciones en "Leche" de "Latte"');
    expect(() => priceLine(latte, [pick("g1", "o1"), pick("g1", "o2")], 1)).toThrow("Elige entre 1 y 1");
    expect(() => priceLine(latte, [pick("g1", "o1"), pick("g2", "e1"), pick("g2", "e2"), pick("g2", "e3")], 1)).toThrow("Elige entre 0 y 2");
  });

  it("rechaza opciones agotadas, inexistentes, repetidas o de un grupo ajeno", () => {
    expect(() => priceLine(latte, [pick("g1", "o3")], 1)).toThrow("ya no está disponible");
    expect(() => priceLine(latte, [pick("g1", "zz")], 1)).toThrow("ya no está disponible");
    expect(() => priceLine(latte, [pick("g1", "o1"), pick("g2", "e1"), pick("g2", "e1")], 1)).toThrow("Opción repetida");
    expect(() => priceLine(latte, [pick("g1", "o1"), pick("zz", "o1")], 1)).toThrow("Opciones inválidas");
  });

  it("rechaza cantidades fuera de 1 a 20 o no enteras", () => {
    for (const q of [0, -1, 21, 1.5, NaN]) expect(() => priceLine(latte, [pick("g1", "o1")], q)).toThrow("Cantidad inválida");
  });

  it("un grupo opcional con min 1 también exige una opción", () => {
    const g = { ...extras, min: 1 };
    expect(() => priceLine({ price: 10, modifiers: [g] }, [], 1)).toThrow("Elige entre 1 y 2");
  });
});

describe("orderTotal", () => {
  it("suma los renglones", () => {
    expect(orderTotal([{ lineTotal: 146 }, { lineTotal: 20.1 }, { lineTotal: 0.2 }])).toBe(166.3);
    expect(orderTotal([])).toBe(0);
  });
});
