import { MAX_QTY, orderTotal, type PickedOption, type PricedOption } from "@/lib/restaurant-pricing";

/** Renglón del carrito. El precio es solo para mostrar: el servidor lo recalcula al recibir el pedido. */
export interface CartLine {
  key: string;
  itemId: string;
  name: string;
  qty: number;
  unitPrice: number;
  note: string;
  options: PricedOption[];
}

export const MAX_LINES = 30;

/** Mismo platillo, mismas opciones y misma nota = mismo renglón. */
export const lineKey = (itemId: string, options: { groupId: string; optionId: string }[], note: string) =>
  `${itemId}|${options.map((o) => `${o.groupId}:${o.optionId}`).sort().join(",")}|${note.trim()}`;

/** Agrega un renglón; si ya existe uno igual, suma la cantidad (tope MAX_QTY). */
export function addLine(cart: CartLine[], line: Omit<CartLine, "key">): CartLine[] {
  const note = line.note.trim();
  const key = lineKey(line.itemId, line.options, note);
  const same = cart.find((l) => l.key === key);
  if (same) return cart.map((l) => (l === same ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty) } : l));
  if (cart.length >= MAX_LINES) throw new Error(`Máximo ${MAX_LINES} productos distintos por pedido`);
  return [...cart, { ...line, note, key, qty: Math.min(MAX_QTY, line.qty) }];
}

/** Cambia la cantidad de un renglón; menos de 1 lo quita. */
export function setQty(cart: CartLine[], key: string, qty: number): CartLine[] {
  if (qty < 1) return cart.filter((l) => l.key !== key);
  return cart.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, qty) } : l));
}

export const lineTotal = (l: CartLine) => orderTotal([{ lineTotal: l.unitPrice * l.qty }]);
export const cartTotal = (cart: CartLine[]) => orderTotal(cart.map((l) => ({ lineTotal: lineTotal(l) })));
export const cartCount = (cart: CartLine[]) => cart.reduce((n, l) => n + l.qty, 0);

/** Lo único que viaja a la Edge Function: qué, cuántos, nota y opciones (nunca precios). */
export const toOrderItems = (cart: CartLine[]) =>
  cart.map((l) => ({
    itemId: l.itemId,
    qty: l.qty,
    ...(l.note ? { note: l.note } : {}),
    options: l.options.map((o): PickedOption => ({ groupId: o.groupId, optionId: o.optionId })),
  }));

// El carrito vive solo en este navegador: una llave por mesa.
export interface Saved {
  name: string;
  cart: CartLine[];
  /** Último pedido hecho desde este navegador (token de seguimiento). */
  tracking: string | null;
}

const storeKey = (token: string) => `comensal:${token}`;

export function readSaved(token: string): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(storeKey(token)) ?? "null");
    if (s && typeof s.name === "string" && Array.isArray(s.cart)) return { name: s.name, cart: s.cart, tracking: s.tracking ?? null };
  } catch {
    // almacenamiento bloqueado o JSON dañado: se empieza de cero
  }
  return { name: "", cart: [], tracking: null };
}

export function writeSaved(token: string, saved: Saved) {
  try {
    localStorage.setItem(storeKey(token), JSON.stringify(saved));
  } catch {
    // modo privado o sin espacio: el carrito solo dura mientras la página siga abierta
  }
}
