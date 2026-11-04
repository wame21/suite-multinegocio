import { describe, expect, it } from "vitest";
import { MAX_QTY } from "@/lib/restaurant-pricing";
import { addLine, cartCount, cartTotal, MAX_LINES, setQty, toOrderItems, type CartLine } from "./cart";

const opt = (groupId: string, optionId: string, extra = 0) => ({ groupId, group: "G", optionId, name: "O", extra });
const line = (over: Partial<Omit<CartLine, "key">> = {}) => ({
  itemId: "latte", name: "Latte", qty: 1, unitPrice: 62, note: "", options: [], ...over,
});

describe("carrito del comensal", () => {
  it("suma la cantidad cuando el platillo, las opciones y la nota son iguales (sin importar el orden)", () => {
    let cart = addLine([], line({ options: [opt("g1", "a"), opt("g2", "b")] }));
    cart = addLine(cart, line({ qty: 2, options: [opt("g2", "b"), opt("g1", "a")], note: "  " }));
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(3);
  });

  it("separa renglones con otra opción o con otra nota", () => {
    let cart = addLine([], line());
    cart = addLine(cart, line({ options: [opt("g1", "a")] }));
    cart = addLine(cart, line({ note: "sin azúcar" }));
    expect(cart).toHaveLength(3);
  });

  it("no pasa de la cantidad máxima ni del máximo de renglones", () => {
    const cart = addLine(addLine([], line({ qty: MAX_QTY })), line({ qty: 5 }));
    expect(cart[0].qty).toBe(MAX_QTY);
    let full: CartLine[] = [];
    for (let i = 0; i < MAX_LINES; i++) full = addLine(full, line({ itemId: `p${i}` }));
    expect(() => addLine(full, line({ itemId: "otro" }))).toThrow("Máximo 30");
  });

  it("cambia la cantidad y quita el renglón al bajar de 1", () => {
    const cart = addLine([], line({ qty: 2 }));
    const key = cart[0].key;
    expect(setQty(cart, key, 3)[0].qty).toBe(3);
    expect(setQty(cart, key, 99)[0].qty).toBe(MAX_QTY);
    expect(setQty(cart, key, 0)).toEqual([]);
  });

  it("calcula total y piezas con centavos", () => {
    let cart = addLine([], line({ qty: 2, unitPrice: 73.5 }));
    cart = addLine(cart, line({ itemId: "pan", unitPrice: 55.1 }));
    expect(cartTotal(cart)).toBe(202.1);
    expect(cartCount(cart)).toBe(3);
    expect(cartTotal([])).toBe(0);
  });

  it("al servidor solo le manda ids, cantidades, notas y opciones, nunca precios", () => {
    const cart = addLine([], line({ qty: 2, note: "sin azúcar", options: [opt("g1", "a", 10)] }));
    expect(toOrderItems(cart)).toEqual([{ itemId: "latte", qty: 2, note: "sin azúcar", options: [{ groupId: "g1", optionId: "a" }] }]);
    expect(JSON.stringify(toOrderItems(cart))).not.toMatch(/price|extra|total/i);
  });
});
