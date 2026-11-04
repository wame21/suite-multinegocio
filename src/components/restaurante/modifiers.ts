import { minPicks, type ModifierGroup } from "@/lib/restaurant-pricing";

// Mismos límites que `valid_modifiers` en la base.
export const MAX_GROUPS = 20;
export const MAX_OPTIONS = 50;

const uid = () => crypto.randomUUID();

export const newOption = () => ({ id: uid(), nombre: "", precio_extra: 0, disponible: true });
export const newGroup = (): ModifierGroup => ({ id: uid(), nombre: "", obligatorio: false, min: 0, max: 1, opciones: [newOption()] });

/** Copia de grupos de otro platillo: ids nuevos para que no choquen con los del platillo destino. */
export const cloneGroups = (groups: ModifierGroup[]): ModifierGroup[] =>
  groups.map((g) => ({ ...g, id: uid(), opciones: g.opciones.map((o) => ({ ...o, id: uid() })) }));

/** Regla en texto, como en el diseño: "Obligatorio · elige 1" / "Opcional · hasta 3". */
export const ruleLabel = (g: ModifierGroup) =>
  `${g.obligatorio ? "Obligatorio" : "Opcional"} · ${g.max === 1 ? "elige 1" : `hasta ${g.max}`}`;

/** Errores que la base rechazaría (o que dejarían el platillo imposible de pedir); vacío si el editor puede guardar. */
export function validateGroups(groups: ModifierGroup[]): string[] {
  const errors: string[] = [];
  if (groups.length > MAX_GROUPS) errors.push(`Máximo ${MAX_GROUPS} grupos por platillo`);
  if (groups.reduce((n, g) => n + g.opciones.length, 0) > MAX_OPTIONS) errors.push(`Máximo ${MAX_OPTIONS} opciones por platillo`);
  groups.forEach((g, i) => {
    const name = g.nombre.trim() || `Grupo ${i + 1}`;
    if (!g.nombre.trim()) errors.push(`${name}: escribe el nombre del grupo`);
    if (!Number.isInteger(g.min) || g.min < 0) errors.push(`${name}: el mínimo debe ser 0 o más`);
    if (!Number.isInteger(g.max) || g.max < Math.max(g.min, 1)) errors.push(`${name}: el máximo debe ser al menos 1 y no menor que el mínimo`);
    if (g.opciones.length < minPicks(g)) errors.push(`${name}: agrega al menos ${minPicks(g)} ${minPicks(g) === 1 ? "opción" : "opciones"}`);
    if (g.opciones.some((o) => !o.nombre.trim())) errors.push(`${name}: todas las opciones necesitan nombre`);
    if (g.opciones.some((o) => !Number.isFinite(o.precio_extra) || o.precio_extra < 0)) errors.push(`${name}: el precio extra no puede ser negativo`);
  });
  return errors;
}
