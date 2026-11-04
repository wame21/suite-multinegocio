import { describe, expect, it } from "vitest";
import type { ModifierGroup } from "@/lib/restaurant-pricing";
import { cloneGroups, newGroup, validateGroups } from "./modifiers";

const group = (patch: Partial<ModifierGroup> = {}): ModifierGroup => ({
  id: "g", nombre: "Leche", obligatorio: true, min: 1, max: 1,
  opciones: [{ id: "o1", nombre: "Entera", precio_extra: 0, disponible: true }], ...patch,
});

describe("validateGroups", () => {
  it("acepta un grupo bien formado y la lista vacía", () => {
    expect(validateGroups([group()])).toEqual([]);
    expect(validateGroups([])).toEqual([]);
  });

  it("un grupo nuevo vacío pide nombre y opción con nombre", () => {
    expect(validateGroups([newGroup()])).toHaveLength(2);
  });

  it("máximo menor que el mínimo (o menor a 1) se rechaza", () => {
    expect(validateGroups([group({ min: 2, max: 1, opciones: group().opciones.concat(group().opciones, group().opciones) })])[0]).toMatch(/máximo/);
    expect(validateGroups([group({ obligatorio: false, min: 0, max: 0 })])[0]).toMatch(/máximo/);
  });

  it("obligatorio exige al menos una opción aunque el mínimo sea 0", () => {
    expect(validateGroups([group({ min: 0, opciones: [] })])[0]).toMatch(/al menos 1 opción/);
  });

  it("el mínimo no puede pedir más opciones de las que hay", () => {
    expect(validateGroups([group({ min: 2, max: 2 })])[0]).toMatch(/al menos 2 opciones/);
  });

  it("precio extra negativo y opciones sin nombre", () => {
    expect(validateGroups([group({ opciones: [{ id: "o", nombre: "Avena", precio_extra: -5, disponible: true }] })])[0]).toMatch(/negativo/);
    expect(validateGroups([group({ opciones: [{ id: "o", nombre: " ", precio_extra: 0, disponible: true }] })])[0]).toMatch(/nombre/);
  });

  it("límites de la base: 20 grupos y 50 opciones", () => {
    expect(validateGroups(Array.from({ length: 21 }, group))[0]).toMatch(/20 grupos/);
    const many = group({ obligatorio: false, min: 0, max: 3, opciones: Array.from({ length: 51 }, (_, i) => ({ id: `o${i}`, nombre: "x", precio_extra: 0, disponible: true })) });
    expect(validateGroups([many])[0]).toMatch(/50 opciones/);
  });
});

describe("cloneGroups", () => {
  it("copia con ids nuevos y conserva el resto", () => {
    const [c] = cloneGroups([group()]);
    expect(c.id).not.toBe("g");
    expect(c.opciones[0].id).not.toBe("o1");
    expect(c.nombre).toBe("Leche");
  });
});
