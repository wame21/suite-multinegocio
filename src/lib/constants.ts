import type {
  BusinessKind,
  Channel,
  CustomerType,
  ExpenseCategory,
  OrderStatus,
  PaymentMethod,
  QuoteStatus,
} from "./types";

/** Nombre del producto; la marca de cada negocio sale de su configuración. */
export const APP_NAME = "Boutique ERP";

export const KIND_LABEL: Record<BusinessKind, string> = {
  boutique: "Boutique",
  restaurante: "Restaurante / cafetería",
};

/** Fixed order — matches the validated categorical palette in globals.css. */
export const CHANNELS: Channel[] = ["tienda", "web", "instagram", "whatsapp", "mayoreo"];

export const CHANNEL_LABEL: Record<Channel, string> = {
  tienda: "Tienda física",
  web: "Página web",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  mayoreo: "Mayoreo",
};

/** CSS variable names defined in globals.css */
export const CHANNEL_COLOR: Record<Channel, string> = {
  tienda: "var(--ch-tienda)",
  web: "var(--ch-web)",
  whatsapp: "var(--ch-whatsapp)",
  instagram: "var(--ch-instagram)",
  mayoreo: "var(--ch-mayoreo)",
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pendiente: "Pendiente de pago",
  apartado: "Apartado (anticipo)",
  pagado: "Pagado · por enviar",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const STATUS_SHORT: Record<OrderStatus, string> = {
  pendiente: "Pendiente",
  apartado: "Apartado",
  pagado: "Pagado",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  convertida: "Convertida en pedido",
  rechazada: "Rechazada",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia / SPEI",
  tarjeta: "Tarjeta (terminal)",
  mercadopago: "Mercado Pago",
  paypal: "PayPal",
};

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  renta: "Renta de locales",
  nomina: "Nómina",
  publicidad: "Publicidad (Meta / TikTok)",
  envios: "Guías y envíos",
  servicios: "Luz, agua e internet",
  empaque: "Empaque y bolsas",
  software: "Software y plataformas",
  otros: "Otros gastos",
};

export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  menudeo: "Minorista",
  mayorista: "Mayorista",
  distribuidor: "Distribuidor",
};
