export type Channel = "tienda" | "web" | "whatsapp" | "instagram" | "mayoreo";

/** Id de sucursal (texto generado por la base de datos). */
export type BranchId = string;

export interface Branch {
  id: BranchId;
  name: string;
  short: string;
  address: string;
  /** Vende en mostrador (aparece en Punto de venta). */
  pos: boolean;
  /** Surte mayoreo y pedidos en línea; máximo una por negocio. */
  isWarehouse: boolean;
  /** Las sucursales no se borran, se archivan. */
  active: boolean;
  sort: number;
}

/** Giro del negocio: define su panel y sus roles. */
export type BusinessKind = "boutique" | "restaurante";

export interface Business {
  id: string;
  name: string;
  kind: BusinessKind;
  inviteCode: string;
  orderPrefix: string;
  quotePrefix: string;
}

/** Categoría de producto: la lista sale de `settings.catalog`. */
export type Category = string;

export interface ProductColor {
  name: string;
  hex: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: Category;
  cost: number;
  price: number;
  sizes: string[];
  colors: ProductColor[];
  minStock: number;
  active: boolean;
  createdAt: string;
  wooId?: number;
}

/** Stock keyed by variant key (`productId|color|size`) then by branch; a missing branch counts as 0. */
export type StockMap = Record<string, Record<BranchId, number>>;

export type MovementType =
  | "entrada"
  | "venta"
  | "ajuste"
  | "traspaso"
  | "cancelacion";

export interface Movement {
  id: string;
  date: string;
  type: MovementType;
  productId: string;
  variantKey: string;
  branch: BranchId;
  qty: number;
  ref?: string;
  note?: string;
}

export interface LineItem {
  productId: string;
  variantKey: string;
  name: string;
  color: string;
  size: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  listPrice: number;
}

export type OrderStatus =
  | "pendiente"
  | "apartado"
  | "pagado"
  | "enviado"
  | "entregado"
  | "cancelado";

export type PaymentMethod =
  | "efectivo"
  | "transferencia"
  | "tarjeta"
  | "mercadopago"
  | "paypal";

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
}

export interface ShippingInfo {
  carrier?: string;
  tracking?: string;
  address?: string;
  city?: string;
}

export interface Order {
  id: string;
  folio: string;
  date: string;
  channel: Channel;
  customerId?: string;
  customerName: string;
  branch: BranchId;
  items: LineItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  payments: Payment[];
  status: OrderStatus;
  shippingInfo?: ShippingInfo;
  notes?: string;
  quoteId?: string;
  tierId?: TierId;
  seller?: string;
  /** Recoge en sucursal (sin envío). */
  pickup: boolean;
}

export type CustomerType = "menudeo" | "mayorista" | "distribuidor";

export interface Customer {
  id: string;
  name: string;
  business?: string;
  phone: string;
  city: string;
  state: string;
  type: CustomerType;
  instagram?: string;
  rfc?: string;
  email?: string;
  since: string;
  notes?: string;
}

/** Id de nivel de mayoreo: los niveles los define el negocio en `settings.wholesale`. */
export type TierId = string;

export type QuoteStatus =
  | "borrador"
  | "enviada"
  | "aceptada"
  | "convertida"
  | "rechazada";

export interface Quote {
  id: string;
  folio: string;
  date: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  items: LineItem[];
  tierId: TierId;
  subtotalList: number;
  discount: number;
  subtotal: number;
  shipping: number;
  total: number;
  depositPct: number;
  status: QuoteStatus;
  notes?: string;
  orderId?: string;
}

export type ExpenseCategory =
  | "renta"
  | "nomina"
  | "publicidad"
  | "envios"
  | "servicios"
  | "empaque"
  | "software"
  | "otros";

export interface Expense {
  id: string;
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  branch?: BranchId;
  method: PaymentMethod;
}

/** Rol en un negocio: vendedor y encargado son de boutique; mesero, cajero y cocina, de restaurante. */
export type Role = "dueno" | "vendedor" | "encargado" | "mesero" | "cajero" | "cocina";

/** Rol guardado en `business_members`: quien se une con código queda pendiente hasta que el dueño lo aprueba. */
export type AppRole = Role | "pendiente";

export interface Profile {
  id: string;
  /** Negocio activo; `null` en una cuenta de dueño que aún no entra a ninguno. */
  businessId: string | null;
  name: string;
  email?: string;
  role: AppRole;
  /** Sucursal asignada; `null` si no tiene (p. ej. el dueño). */
  branch: BranchId | null;
  createdAt: string;
}

/** Datos del negocio que se cargan de Supabase. Fechas en ISO. */
export interface ErpData {
  products: Product[];
  stock: StockMap;
  movements: Movement[];
  orders: Order[];
  customers: Customer[];
  quotes: Quote[];
  expenses: Expense[];
}

/** `revision` y `rechazada`: negocio recién registrado que el administrador de la plataforma aún no acepta. */
export type MembershipState = "revision" | "rechazada" | "prueba" | "activa" | "gracia" | "vencida" | "suspendida";

/** Fila de `my_businesses()`: un negocio de la cuenta, con su estado de cobro. */
export interface OwnerBusiness {
  id: string;
  name: string;
  kind: BusinessKind;
  role: AppRole;
  state: MembershipState;
  endsAt: string | null;
  rejectionReason: string | null;
  /** Solo donde la cuenta es dueña. */
  monthSales: number | null;
  active: boolean;
  createdAt: string;
}

/** Datos para pagar la membresía; los edita el administrador de la plataforma. */
export interface PaymentDetails {
  bank: string;
  clabe: string;
  holder: string;
  whatsapp: string;
}

/** Membresía del negocio calculada por la base (`my_membership`), con los precios y datos de cobro vigentes. */
export interface Membership {
  state: MembershipState;
  trialEndsAt: string | null;
  paidUntil: string | null;
  graceEndsAt: string | null;
  suspendedReason: string | null;
  priceMonthly: number;
  priceSetup: number;
  payment: PaymentDetails;
}
