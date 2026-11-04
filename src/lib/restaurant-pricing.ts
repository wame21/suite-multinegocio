/**
 * Precio de un platillo con modificadores. Es el mismo cálculo (y los mismos mensajes) que
 * `place_table_order` en la base: sirve para mostrar el total en vivo al comensal, pero el
 * servidor siempre lo recalcula y es el que manda.
 */
export interface ModifierOption {
  id: string;
  nombre: string;
  precio_extra: number;
  disponible: boolean;
}

export interface ModifierGroup {
  id: string;
  nombre: string;
  obligatorio: boolean;
  min: number;
  max: number;
  opciones: ModifierOption[];
}

/** Lo que el comensal elige: la opción `optionId` del grupo `groupId`. */
export interface PickedOption {
  groupId: string;
  optionId: string;
}

/** Foto de una opción elegida: no cambia si el dueño edita el menú después. */
export interface PricedOption {
  groupId: string;
  group: string;
  optionId: string;
  name: string;
  extra: number;
}

export const MAX_QTY = 20;

const cents = (n: number) => Math.round(n * 100) / 100;

/** Mínimo efectivo de un grupo: un grupo obligatorio exige al menos una opción. */
export const minPicks = (g: ModifierGroup) => Math.max(g.min, g.obligatorio ? 1 : 0);

/**
 * Precio unitario y total de `qty` piezas de un platillo con las opciones elegidas.
 * Lanza un Error en español si algo no cuadra (opción inexistente o agotada, fuera de min/max, repetida).
 */
export function priceLine(
  item: { price: number; name?: string; modifiers: ModifierGroup[] },
  picks: PickedOption[],
  qty: number,
): { unitPrice: number; lineTotal: number; options: PricedOption[] } {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error("Cantidad inválida");
  if (picks.some((p) => !item.modifiers.some((g) => g.id === p.groupId))) throw new Error("Opciones inválidas");

  let unit = item.price;
  const options: PricedOption[] = [];
  for (const g of item.modifiers) {
    const chosen = picks.filter((p) => p.groupId === g.id);
    if (chosen.length < minPicks(g) || chosen.length > g.max) {
      throw new Error(`Elige entre ${minPicks(g)} y ${g.max} opciones en "${g.nombre}"${item.name ? ` de "${item.name}"` : ""}`);
    }
    if (new Set(chosen.map((p) => p.optionId)).size !== chosen.length) throw new Error(`Opción repetida en "${g.nombre}"`);
    for (const p of chosen) {
      const o = g.opciones.find((x) => x.id === p.optionId && x.disponible);
      if (!o) throw new Error(`Una opción de "${g.nombre}" ya no está disponible`);
      unit = cents(unit + o.precio_extra);
      options.push({ groupId: g.id, group: g.nombre, optionId: o.id, name: o.nombre, extra: o.precio_extra });
    }
  }
  return { unitPrice: unit, lineTotal: cents(unit * qty), options };
}

/** Total del pedido a partir de sus renglones ya calculados. */
export const orderTotal = (lines: { lineTotal: number }[]) => cents(lines.reduce((s, l) => s + l.lineTotal, 0));
