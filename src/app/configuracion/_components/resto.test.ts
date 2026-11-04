import { describe, expect, it } from "vitest";
import { validateMenuPublico, validatePagos } from "./resto";

const base = { methods: ["efectivo", "tarjeta"] as ("efectivo" | "tarjeta" | "transferencia")[], transfer: { bank: "", holder: "", clabe: "" }, folioPrefix: "A" };

describe("validatePagos", () => {
  it("acepta efectivo y tarjeta sin datos bancarios", () => expect(validatePagos(base)).toEqual([]));

  it("exige al menos un método", () => expect(validatePagos({ ...base, methods: [] })[0]).toMatch(/al menos un método/));

  it("transferencia pide banco, titular y CLABE de 18 dígitos", () => {
    const t = { ...base, methods: ["transferencia" as const] };
    expect(validatePagos(t)).toHaveLength(2);
    expect(validatePagos({ ...t, transfer: { bank: "BBVA", holder: "Café", clabe: "123" } })).toEqual(["La CLABE lleva 18 dígitos"]);
    expect(validatePagos({ ...t, transfer: { bank: "BBVA", holder: "Café", clabe: "012345678901234567" } })).toEqual([]);
  });

  it("prefijo de folio: 1 a 4 letras", () => {
    for (const bad of ["", "ABCDE", "A1", "A-"]) expect(validatePagos({ ...base, folioPrefix: bad })).toHaveLength(1);
    expect(validatePagos({ ...base, folioPrefix: "Cafe" })).toEqual([]);
  });
});

describe("validateMenuPublico", () => {
  it("mensaje hasta 200 y color hex de 6 dígitos", () => {
    expect(validateMenuPublico("x".repeat(200), "#b8892b")).toEqual([]);
    expect(validateMenuPublico("x".repeat(201), null)).toHaveLength(1);
    expect(validateMenuPublico("", "rojo")).toHaveLength(1);
  });
});
