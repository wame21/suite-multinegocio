import type { PayMethod, RestaurantSettings } from "@/lib/restaurant";

export const METHOD_INFO: Record<PayMethod, { label: string; hint: string }> = {
  efectivo: { label: "Efectivo", hint: "El cliente paga en caja o al mesero" },
  tarjeta: { label: "Tarjeta", hint: "Terminal en la mesa o en caja" },
  transferencia: { label: "Transferencia", hint: "Mostramos tus datos bancarios al comensal" },
};

export const WELCOME_MAX = 200;

/** Errores de la pestaña Pagos; vacío si se puede guardar. */
export function validatePagos(s: Pick<RestaurantSettings, "methods" | "transfer" | "folioPrefix">): string[] {
  const errors: string[] = [];
  if (s.methods.length === 0) errors.push("Acepta al menos un método de pago");
  if (s.methods.includes("transferencia")) {
    if (!s.transfer.bank.trim() || !s.transfer.holder.trim()) errors.push("Para aceptar transferencias escribe el banco y el titular");
    if (!/^\d{18}$/.test(s.transfer.clabe.trim())) errors.push("La CLABE lleva 18 dígitos");
  }
  if (!/^[A-Za-z]{1,4}$/.test(s.folioPrefix.trim())) errors.push("El prefijo de folio lleva de 1 a 4 letras");
  return errors;
}

export function validateMenuPublico(welcome: string, accent: string | null): string[] {
  const errors: string[] = [];
  if (welcome.length > WELCOME_MAX) errors.push(`El mensaje admite hasta ${WELCOME_MAX} caracteres`);
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) errors.push("El color debe ser un color válido");
  return errors;
}
