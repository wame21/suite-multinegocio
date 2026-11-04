"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useMemo } from "react";
import { create } from "zustand";
import { activeBranches, applyBranches, posBranches, warehouseOf } from "./branches";
import { APP_NAME } from "./constants";
import { isBlocked } from "./membership";
import {
  applyCatalogSettings,
  applySalesSettings,
  catalogFrom,
  profileFrom,
  salesFrom,
  type BusinessProfile,
  type CatalogSettings,
  type SalesSettings,
} from "./settings";
import { supabase } from "./supabase/client";
import type {
  AppRole,
  Branch,
  BranchId,
  Business,
  BusinessKind,
  Channel,
  Customer,
  ErpData,
  Expense,
  LineItem,
  Membership,
  Movement,
  MovementType,
  Order,
  OrderStatus,
  OwnerBusiness,
  Payment,
  Product,
  Profile,
  Quote,
  Role,
  ShippingInfo,
  StockMap,
  TierId,
} from "./types";
import { applyWholesaleSettings, DEFAULT_WHOLESALE, wholesaleFrom, wholesaleSnapshot, type WholesaleSettings } from "./wholesale";

export interface NewOrderInput {
  channel: Channel;
  customerId?: string;
  customerName: string;
  branch: BranchId;
  items: LineItem[];
  discount?: number;
  shipping?: number;
  payments?: Omit<Payment, "id" | "date">[];
  status?: OrderStatus;
  notes?: string;
  shippingInfo?: ShippingInfo;
  tierId?: TierId;
  quoteId?: string;
  seller?: string;
  pickup?: boolean;
}

/** Datos para crear (sin `id`) o editar (con `id`) una sucursal. */
export interface BranchInput {
  id?: BranchId;
  name: string;
  short: string;
  address: string;
  pos: boolean;
  isWarehouse: boolean;
  active: boolean;
  sort?: number;
}

type StockEntry = { variantKey: string; qty: number };
type PaymentInput = Omit<Payment, "id" | "date">;

/** Tablas que se recargan cuando cambian (por esta pestaña o por otro usuario en tiempo real). */
type Table = "products" | "stock" | "movements" | "orders" | "customers" | "quotes" | "expenses" | "branches" | "settings";

interface Actions {
  init: () => Promise<void>;
  /** Cambia el negocio activo (`set_active_business`) y recarga todo: store y canal realtime empiezan de cero. */
  switchBusiness: (id: string) => Promise<void>;
  /** Suelta datos y canal del negocio (al salir a Mis negocios). */
  reset: () => Promise<void>;
  signOut: () => Promise<void>;
  reload: (tables: Table[]) => Promise<void>;

  createOrder: (input: NewOrderInput) => Promise<Order>;
  addPayment: (orderId: string, payment: PaymentInput) => Promise<void>;
  setOrderStatus: (orderId: string, status: OrderStatus, shippingInfo?: ShippingInfo) => Promise<void>;

  moveStock: (entries: StockEntry[], branch: BranchId, type: Extract<MovementType, "entrada" | "ajuste">, meta?: { ref?: string; note?: string }) => Promise<void>;
  transferStock: (entries: StockEntry[], from: BranchId, to: BranchId) => Promise<void>;
  addProduct: (p: Omit<Product, "id" | "createdAt">) => Promise<Product>;
  updateProduct: (id: string, patch: Partial<Product>) => Promise<void>;

  addCustomer: (c: Omit<Customer, "id" | "since">) => Promise<Customer>;
  updateCustomer: (id: string, patch: Partial<Customer>) => Promise<void>;

  saveQuote: (q: Omit<Quote, "id" | "folio"> & { id?: string }) => Promise<Quote>;
  setQuoteStatus: (id: string, status: Quote["status"]) => Promise<void>;
  convertQuote: (id: string, deposit: PaymentInput) => Promise<Order>;

  addExpense: (e: Omit<Expense, "id">) => Promise<void>;
  removeExpense: (id: string) => Promise<void>;

  loadTeam: () => Promise<void>;
  setMember: (id: string, role: AppRole, branch: BranchId | null) => Promise<void>;

  /** Nombre y prefijos de folio del negocio (solo dueño). */
  saveBusiness: (b: { name: string; orderPrefix: string; quotePrefix: string }) => Promise<void>;
  /** Genera un código de invitación nuevo (el anterior deja de servir) y lo devuelve. */
  regenerateInviteCode: () => Promise<string>;

  saveProfileSettings: (next: BusinessProfile) => Promise<void>;
  saveCatalog: (next: CatalogSettings) => Promise<void>;
  saveSales: (next: SalesSettings) => Promise<void>;
  saveWholesale: (next: WholesaleSettings) => Promise<void>;

  /** Crea o edita una sucursal; nunca se borran. Marcar `isWarehouse` desmarca la anterior. */
  saveBranch: (b: BranchInput) => Promise<Branch>;

  /** Sube el logo al bucket `logos`, lo guarda en `profileSettings.logoUrl` y devuelve la URL pública. */
  uploadLogo: (file: File) => Promise<string>;
  removeLogo: () => Promise<void>;
}

/** Configuración del negocio cargada de Supabase; sus snapshots hacen que React se re-renderice. */
interface Config {
  business: Business | null;
  branches: Branch[];
  /** `settings.profile` */
  profileSettings: BusinessProfile;
  /** `settings.catalog` */
  catalog: CatalogSettings;
  /** `settings.sales` */
  sales: SalesSettings;
  /** `settings.wholesale` */
  wholesale: WholesaleSettings;
}

interface Session {
  status: "loading" | "ready" | "error";
  error?: string;
  profile: Profile | null;
  /** Rol efectivo para la interfaz; los pendientes nunca llegan a ver datos. */
  role: Role;
  team: Profile[];
  /** Conectado al canal de tiempo real. */
  live: boolean;
  /** `my_membership()`; `null` hasta que carga (o si la cuenta está pendiente). */
  membership: Membership | null;
  /** Giro del negocio activo (boutique mientras no hay uno). */
  kind: BusinessKind;
  /** Fila de `my_businesses()` del negocio activo: nombre, giro y estado, también para el personal pendiente. */
  active: OwnerBusiness | null;
}

type Data = ErpData & Config;

export type ErpState = Data & Session & Actions;

/* ------------------------------------------------------------------ */
/* Filas de Postgres ↔ tipos de la app                                  */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const opt = <T>(v: T | null | undefined) => v ?? undefined;
const num = (v: unknown) => Number(v ?? 0);

/** Persona (`profiles`) con su membresía en el negocio activo; sin membresía es una cuenta de dueño que aún no entra a un negocio. */
const toProfile = (r: Row, m?: Row | null): Profile => ({
  id: r.id,
  businessId: m?.business_id ?? null,
  name: r.name,
  email: opt(r.email),
  role: m?.role ?? "dueno",
  branch: m?.branch ?? null,
  createdAt: r.created_at,
});

/** Integrante de `business_members` con los datos de `profiles` unidos. */
const toMember = (r: Row): Profile => ({
  id: r.user_id,
  businessId: r.business_id,
  name: r.profiles?.name ?? "",
  email: opt(r.profiles?.email),
  role: r.role,
  branch: r.branch ?? null,
  createdAt: r.created_at,
});

const toBusiness = (r: Row): Business => ({
  id: r.id,
  name: r.name,
  kind: r.kind ?? "boutique",
  inviteCode: r.invite_code,
  orderPrefix: r.order_prefix,
  quotePrefix: r.quote_prefix,
});

const toBranch = (r: Row): Branch => ({
  id: r.id,
  name: r.name,
  short: r.short,
  address: r.address ?? "",
  pos: r.pos,
  isWarehouse: r.is_warehouse,
  active: r.active,
  sort: num(r.sort),
});

/** El costo vive en `product_costs` (solo el dueño lo lee); sin él vale 0. */
const toProduct = (r: Row, cost = 0): Product => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  brand: r.brand,
  category: r.category,
  cost,
  price: num(r.price),
  sizes: r.sizes,
  colors: r.colors,
  minStock: r.min_stock,
  active: r.active,
  createdAt: r.created_at,
  wooId: opt(r.woo_id),
});

const productRow = (p: Partial<Product>): Row => {
  const r: Row = {};
  if (p.sku !== undefined) r.sku = p.sku;
  if (p.name !== undefined) r.name = p.name;
  if (p.brand !== undefined) r.brand = p.brand;
  if (p.category !== undefined) r.category = p.category;
  if (p.price !== undefined) r.price = p.price;
  if (p.sizes !== undefined) r.sizes = p.sizes;
  if (p.colors !== undefined) r.colors = p.colors;
  if (p.minStock !== undefined) r.min_stock = p.minStock;
  if (p.active !== undefined) r.active = p.active;
  if (p.wooId !== undefined) r.woo_id = p.wooId;
  return r;
};

const toStock = (rows: Row[]): StockMap => {
  const map: StockMap = {};
  for (const r of rows) {
    map[r.variant_key] ??= {};
    map[r.variant_key][r.branch as BranchId] = r.qty;
  }
  return map;
};

const toMovement = (r: Row): Movement => ({
  id: r.id,
  date: r.date,
  type: r.type,
  productId: r.product_id,
  variantKey: r.variant_key,
  branch: r.branch,
  qty: r.qty,
  ref: opt(r.ref),
  note: opt(r.note),
});

/** `costs` = costo unitario por variante de `order_costs` (solo el dueño); sin él vale 0. */
const toOrder = (r: Row, costs: Row = {}): Order => ({
  id: r.id,
  folio: r.folio,
  date: r.date,
  channel: r.channel,
  customerId: opt(r.customer_id),
  customerName: r.customer_name,
  branch: r.branch,
  items: (r.items as LineItem[]).map((i) => ({ ...i, unitCost: num(costs[i.variantKey]) })),
  subtotal: num(r.subtotal),
  discount: num(r.discount),
  shipping: num(r.shipping),
  total: num(r.total),
  payments: (r.payments as Payment[]).map((p) => ({ ...p, amount: num(p.amount) })),
  status: r.status,
  shippingInfo: opt(r.shipping_info),
  notes: opt(r.notes),
  quoteId: opt(r.quote_id),
  tierId: opt(r.tier_id),
  seller: opt(r.seller),
  pickup: r.pickup ?? false,
});

const toCustomer = (r: Row): Customer => ({
  id: r.id,
  name: r.name,
  business: opt(r.business),
  phone: r.phone,
  city: r.city,
  state: r.state,
  type: r.type,
  instagram: opt(r.instagram),
  rfc: opt(r.rfc),
  email: opt(r.email),
  since: r.since,
  notes: opt(r.notes),
});

const customerRow = (c: Partial<Customer>): Row => {
  const r: Row = {};
  for (const k of ["name", "business", "phone", "city", "state", "type", "instagram", "rfc", "email", "notes"] as const)
    if (c[k] !== undefined) r[k] = c[k];
  return r;
};

/** `costs` = costo actual por producto de `product_costs` (solo el dueño); sin él vale 0. */
const toQuote = (r: Row, costs: Row = {}): Quote => ({
  id: r.id,
  folio: r.folio,
  date: r.date,
  validUntil: r.valid_until,
  customerId: r.customer_id,
  customerName: r.customer_name,
  items: (r.items as LineItem[]).map((i) => ({ ...i, unitCost: num(costs[i.productId]) })),
  tierId: r.tier_id,
  subtotalList: num(r.subtotal_list),
  discount: num(r.discount),
  subtotal: num(r.subtotal),
  shipping: num(r.shipping),
  total: num(r.total),
  depositPct: num(r.deposit_pct),
  status: r.status,
  notes: opt(r.notes),
  orderId: opt(r.order_id),
});

const toExpense = (r: Row): Expense => ({
  id: r.id,
  date: r.date,
  category: r.category,
  description: r.description,
  amount: num(r.amount),
  branch: opt(r.branch),
  method: r.method,
});

/* ------------------------------------------------------------------ */
/* Acceso a datos                                                       */
/* ------------------------------------------------------------------ */
const PAGE = 1000;
const MOVEMENTS_LIMIT = 1000;

/** Supabase devuelve máximo 1000 filas por consulta; esto pagina hasta traer todas. */
async function fetchAll(table: string, order: [column: string, ascending: boolean][]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase().from(table).select("*");
    for (const [column, ascending] of order) q = q.order(column, { ascending });
    const data = must(await q.range(from, from + PAGE - 1));
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** Devuelve `data` o lanza el mensaje de error de Postgres (p. ej. "Sin existencia suficiente…"). */
function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) {
    // La cuenta se bloqueó con la sesión abierta: init lleva a la pantalla de pago
    if (res.error.message === "Cuenta suspendida" || res.error.message === "Membresía vencida") void useErp.getState().init();
    // Las escrituras directas por tabla fallan por RLS sin mensaje propio: solo se re-inicia si de verdad está bloqueada
    else if (/row-level security/.test(res.error.message))
      void supabase().rpc("my_membership").then(({ data }) => {
        if (isBlocked(data as Membership | null)) void useErp.getState().init();
      });
    throw new Error(res.error.message);
  }
  return res.data as T;
}

/** Las configuraciones y sucursales vigentes se aplican al cargar, antes del primer render. */
const productCosts = async (owner: boolean): Promise<Row> =>
  owner ? Object.fromEntries((await fetchAll("product_costs", [["product_id", true]])).map((r) => [r.product_id, r.cost])) : {};

const LOADERS: Record<Table, (businessId: string, owner: boolean) => Promise<Partial<Data>>> = {
  products: async (_, owner) => {
    const [rows, costs] = await Promise.all([fetchAll("products", [["created_at", true], ["id", true]]), productCosts(owner)]);
    return { products: rows.map((r) => toProduct(r, num(costs[r.id]))) };
  },
  stock: async () => ({ stock: toStock(await fetchAll("stock", [["variant_key", true], ["branch", true]])) }),
  movements: async () => {
    const res = await supabase().from("movements").select("*").order("date", { ascending: false }).limit(MOVEMENTS_LIMIT);
    return { movements: must(res).map(toMovement) };
  },
  orders: async (_, owner) => {
    const [rows, costRows] = await Promise.all([
      fetchAll("orders", [["date", true], ["id", true]]),
      owner ? fetchAll("order_costs", [["order_id", true]]) : [],
    ]);
    const costs = Object.fromEntries(costRows.map((r) => [r.order_id, r.costs]));
    return { orders: rows.map((r) => toOrder(r, costs[r.id])) };
  },
  customers: async () => ({ customers: (await fetchAll("customers", [["since", true], ["id", true]])).map(toCustomer) }),
  quotes: async (_, owner) => {
    const [rows, costs] = await Promise.all([fetchAll("quotes", [["date", true], ["id", true]]), productCosts(owner)]);
    return { quotes: rows.map((r) => toQuote(r, costs)) };
  },
  expenses: async () => ({ expenses: (await fetchAll("expenses", [["date", false], ["id", true]])).map(toExpense) }),
  branches: async () => {
    const branches = (await fetchAll("branches", [["sort", true], ["created_at", true], ["id", true]])).map(toBranch);
    applyBranches(branches);
    return { branches };
  },
  settings: async (businessId) => {
    const rows = must(await supabase().from("settings").select("key, value").eq("business_id", businessId)) as Row[];
    const value = (key: string) => rows.find((r) => r.key === key)?.value;
    const catalog = catalogFrom(value("catalog"));
    const sales = salesFrom(value("sales"));
    applyCatalogSettings(catalog);
    applySalesSettings(sales);
    applyWholesaleSettings(wholesaleFrom(value("wholesale")));
    return { profileSettings: profileFrom(value("profile")), catalog, sales, wholesale: wholesaleSnapshot() };
  },
};

const ALL_TABLES = Object.keys(LOADERS) as Table[];

async function loadBusiness(businessId: string) {
  return toBusiness(must(await supabase().from("businesses").select("*").eq("id", businessId).single()));
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

const emptySession = (): Pick<Session, "team" | "membership" | "kind" | "active" | "live"> => ({
  team: [],
  membership: null,
  kind: "boutique",
  active: null,
  live: false,
});
const EMPTY: ErpData = { products: [], stock: {}, movements: [], orders: [], customers: [], quotes: [], expenses: [] };

/** Mientras cargan, se usan los valores por defecto de cada configuración. */
const DEFAULT_CONFIG: Config = {
  business: null,
  branches: [],
  profileSettings: profileFrom(undefined),
  catalog: catalogFrom(undefined),
  sales: salesFrom(undefined),
  wholesale: wholesaleSnapshot(),
};

let channel: RealtimeChannel | undefined;
/** Una sola carga a la vez: el shell y `switchBusiness` pueden pedirla casi juntos. */
let initializing: Promise<void> | undefined;

/** Recarga completa hacia /login: así no queda en memoria ningún dato del negocio. */
function goToLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- se busca descartar el estado en memoria
  window.location.assign("/login");
}
const pending = new Map<Table, ReturnType<typeof setTimeout>>();

const LOGOS_BUCKET = "logos";
const LOGO_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Ruta dentro del bucket a partir de la URL pública de un logo. */
const logoPath = (url: string) => {
  const tail = url.split(`/${LOGOS_BUCKET}/`)[1];
  return tail ? decodeURIComponent(tail.split("?")[0]) : undefined;
};

/** Borra el archivo de un logo anterior; si falla no importa, solo queda un archivo huérfano. */
async function removeLogoFile(url: string | null) {
  const path = url ? logoPath(url) : undefined;
  if (path) await supabase().storage.from(LOGOS_BUCKET).remove([path]).catch(() => {});
}

export const useErp = create<ErpState>()((set, get) => {
  /** Recarga una tabla poco después del último cambio, para agrupar ráfagas de eventos. */
  const schedule = (table: Table) => {
    clearTimeout(pending.get(table));
    pending.set(
      table,
      setTimeout(() => {
        pending.delete(table);
        void get().reload(table === "stock" ? ["stock", "movements"] : [table]).catch(() => {});
      }, 300),
    );
  };

  // La escritura ya quedó guardada: si la recarga falla, realtime vuelve a sincronizar.
  const refresh = (tables: Table[]) => get().reload(tables).catch((e) => console.error(e));

  const subscribe = () => {
    if (channel) return;
    channel = supabase().channel("erp");
    // Las tablas de boutique solo se escuchan en ese giro; el restaurante suscribe las suyas.
    if (get().kind === "boutique") {
      for (const table of ["orders", "stock", "quotes", "customers", "products", "expenses", "branches", "settings"] as const)
        channel.on("postgres_changes", { event: "*", schema: "public", table }, () => schedule(table));
    }
    if (get().kind === "boutique" && get().role === "dueno") {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "product_costs" }, () => {
        schedule("products");
        schedule("quotes");
      });
      channel.on("postgres_changes", { event: "*", schema: "public", table: "order_costs" }, () => schedule("orders"));
    }
    channel.subscribe((status) => set({ live: status === "SUBSCRIBED" }));
  };

  const businessId = () => {
    const id = get().profile?.businessId;
    if (!id) throw new Error("No hay una sesión activa");
    return id;
  };

  /** Guarda un valor de `settings` del negocio (llave única por negocio). */
  const saveSetting = async (key: "profile" | "catalog" | "sales" | "wholesale", value: unknown) => {
    must(
      await supabase()
        .from("settings")
        .upsert({ business_id: businessId(), key, value, updated_at: new Date().toISOString() }, { onConflict: "business_id,key" })
        .select()
        .single(),
    );
  };

  const load = async () => {
    set({ status: "loading", error: undefined });
    try {
      const sb = supabase();
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) return goToLogin();
      const row = must(await sb.from("profiles").select("*").eq("id", auth.user.id).single()) as Row;
      const activeId: string | null = row.active_business_id ?? null;
      const [member, mine] = activeId
        ? await Promise.all([
            sb.from("business_members").select("*").eq("user_id", auth.user.id).eq("business_id", activeId).maybeSingle(),
            sb.rpc("my_businesses"),
          ])
        : [null, null];
      const profile = toProfile(row, member && (must(member) as Row | null));
      const active = ((mine && must(mine)) as OwnerBusiness[] | null)?.find((b) => b.id === activeId) ?? null;
      const kind = active?.kind ?? "boutique";
      set({ profile, role: profile.role === "pendiente" ? "vendedor" : profile.role, kind, active });
      // Cuenta de dueño sin negocio activo, o personal pendiente: no hay datos que cargar.
      if (!profile.businessId || profile.role === "pendiente") {
        set({ status: "ready" });
        return;
      }
      const membership = must(await sb.rpc("my_membership")) as Membership;
      set({ membership });
      if (isBlocked(membership)) {
        set({ status: "ready" });
        return;
      }
      const owner = profile.role === "dueno";
      // Las tablas de boutique y su canal solo se cargan en ese giro.
      const [business, ...parts] = await Promise.all([
        owner || kind === "boutique" ? loadBusiness(profile.businessId) : null,
        ...(kind === "boutique" ? ALL_TABLES.map((t) => LOADERS[t](profile.businessId!, owner)) : []),
      ]);
      set({ ...Object.assign({}, ...parts), business, status: "ready" });
      subscribe();
    } catch (e) {
      set({ status: "error", error: errorMessage(e) });
    }
  };

  return {
    ...EMPTY,
    ...DEFAULT_CONFIG,
    ...emptySession(),
    status: "loading",
    profile: null,
    role: "vendedor",

    init: () => (initializing ??= load().finally(() => (initializing = undefined))),

    switchBusiness: async (id) => {
      must(await supabase().rpc("set_active_business", { p_id: id }));
      await get().reset();
      await get().init();
    },

    reset: async () => {
      if (channel) await supabase().removeChannel(channel);
      channel = undefined;
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      // la configuración de módulo del negocio anterior no debe filtrarse al siguiente
      applyBranches([]);
      applyCatalogSettings(catalogFrom(undefined));
      applySalesSettings(salesFrom(undefined));
      applyWholesaleSettings(DEFAULT_WHOLESALE);
      set({ ...EMPTY, ...DEFAULT_CONFIG, ...emptySession(), profile: null, role: "vendedor", status: "loading", error: undefined });
    },

    signOut: async () => {
      if (channel) await supabase().removeChannel(channel);
      channel = undefined;
      await supabase().auth.signOut();
      goToLogin();
    },

    reload: async (tables) => {
      const id = businessId();
      const parts = await Promise.all(tables.map((t) => LOADERS[t](id, get().role === "dueno")));
      set(Object.assign({}, ...parts));
    },

    createOrder: async (input) => {
      const row = must(await supabase().rpc("create_order", { p: { ...input, seller: input.seller ?? get().profile?.name } }));
      const order = toOrder(row as Row);
      set((s) => ({ orders: upsert(s.orders, order) }));
      await refresh(["stock", "movements"]);
      return order;
    },

    addPayment: async (orderId, payment) => {
      const row = must(await supabase().rpc("add_payment", { p_order: orderId, p_payment: payment }));
      set((s) => ({ orders: upsert(s.orders, toOrder(row as Row)) }));
    },

    setOrderStatus: async (orderId, status, shippingInfo) => {
      const row = must(
        await supabase().rpc("set_order_status", { p_order: orderId, p_status: status, p_shipping: shippingInfo ?? null }),
      );
      set((s) => ({ orders: upsert(s.orders, toOrder(row as Row)) }));
      if (status === "cancelado") await refresh(["stock", "movements"]);
    },

    moveStock: async (entries, branch, type, meta) => {
      must(
        await supabase().rpc("move_stock", {
          p_entries: entries,
          p_branch: branch,
          p_type: type,
          p_ref: meta?.ref ?? null,
          p_note: meta?.note ?? null,
        }),
      );
      await refresh(["stock", "movements"]);
    },

    transferStock: async (entries, from, to) => {
      must(await supabase().rpc("transfer_stock", { p_entries: entries, p_from: from, p_to: to }));
      await refresh(["stock", "movements"]);
    },

    addProduct: async (p) => {
      const product = toProduct(must(await supabase().from("products").insert(productRow(p)).select().single()), p.cost);
      must(await supabase().from("product_costs").upsert({ product_id: product.id, cost: p.cost }, { onConflict: "product_id" }));
      set((s) => ({ products: upsert(s.products, product) }));
      await refresh(["stock"]);
      return product;
    },

    updateProduct: async (id, patch) => {
      const row = must(await supabase().from("products").update(productRow(patch)).eq("id", id).select().single()) as Row;
      if (patch.cost !== undefined)
        must(await supabase().from("product_costs").upsert({ product_id: id, cost: patch.cost }, { onConflict: "product_id" }));
      const product = toProduct(row, patch.cost ?? get().products.find((x) => x.id === id)?.cost);
      set((s) => ({ products: upsert(s.products, product) }));
    },

    addCustomer: async (c) => {
      const customer = toCustomer(must(await supabase().from("customers").insert(customerRow(c)).select().single()));
      set((s) => ({ customers: upsert(s.customers, customer) }));
      return customer;
    },

    updateCustomer: async (id, patch) => {
      const customer = toCustomer(must(await supabase().from("customers").update(customerRow(patch)).eq("id", id).select().single()));
      set((s) => ({ customers: upsert(s.customers, customer) }));
    },

    saveQuote: async (q) => {
      const quote = toQuote(must(await supabase().rpc("save_quote", { p: q })) as Row);
      set((s) => ({ quotes: upsert(s.quotes, quote) }));
      return quote;
    },

    setQuoteStatus: async (id, status) => {
      const quote = toQuote(must(await supabase().rpc("set_quote_status", { p_id: id, p_status: status })) as Row);
      set((s) => ({ quotes: upsert(s.quotes, quote) }));
    },

    convertQuote: async (id, deposit) => {
      const order = toOrder(must(await supabase().rpc("convert_quote", { p_quote: id, p_deposit: deposit })) as Row);
      set((s) => ({ orders: upsert(s.orders, order) }));
      await refresh(["quotes", "stock", "movements"]);
      return order;
    },

    addExpense: async (e) => {
      const expense = toExpense(
        must(
          await supabase()
            .from("expenses")
            .insert({ date: e.date, category: e.category, description: e.description, amount: e.amount, branch: e.branch ?? null, method: e.method })
            .select()
            .single(),
        ),
      );
      set((s) => ({ expenses: [expense, ...s.expenses.filter((x) => x.id !== expense.id)] }));
    },

    removeExpense: async (id) => {
      must(await supabase().from("expenses").delete().eq("id", id));
      set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }));
    },

    loadTeam: async () => {
      const rows = must(
        await supabase().from("business_members").select("*, profiles(name, email)").order("created_at", { ascending: true }),
      ) as Row[];
      set({ team: rows.map(toMember) });
    },

    setMember: async (id, role, branch) => {
      // set_member devuelve la fila de business_members, sin los datos de la persona: se conservan los que ya están
      const row = must(await supabase().rpc("set_member", { p_id: id, p_role: role, p_branch: branch })) as Row;
      set((s) => ({ team: s.team.map((m) => (m.id === id ? { ...m, role: row.role, branch: row.branch ?? null } : m)) }));
    },

    saveBusiness: async (b) => {
      const business = toBusiness(
        must(
          await supabase().rpc("update_business", { p_name: b.name, p_order_prefix: b.orderPrefix, p_quote_prefix: b.quotePrefix }),
        ) as Row,
      );
      set({ business });
    },

    regenerateInviteCode: async () => {
      const code = must(await supabase().rpc("regenerate_invite_code")) as string;
      set((s) => ({ business: s.business && { ...s.business, inviteCode: code } }));
      return code;
    },

    saveProfileSettings: async (next) => {
      await saveSetting("profile", next);
      set({ profileSettings: next });
    },

    saveCatalog: async (next) => {
      await saveSetting("catalog", next);
      applyCatalogSettings(next);
      set({ catalog: next });
    },

    saveSales: async (next) => {
      await saveSetting("sales", next);
      applySalesSettings(next);
      set({ sales: next });
    },

    saveWholesale: async (next) => {
      await saveSetting("wholesale", next);
      applyWholesaleSettings(next);
      set({ wholesale: wholesaleSnapshot() });
    },

    saveBranch: async (b) => {
      const sb = supabase();
      // Solo puede haber una sucursal que surte: se desmarca la anterior antes de marcar esta
      let released: string[] = [];
      if (b.isWarehouse) {
        let q = sb.from("branches").update({ is_warehouse: false }).eq("is_warehouse", true);
        if (b.id) q = q.neq("id", b.id);
        released = must(await q.select("id")).map((r: Row) => r.id);
      }
      const row: Row = { name: b.name, short: b.short, address: b.address, pos: b.pos, is_warehouse: b.isWarehouse, active: b.active };
      let saved: Branch;
      try {
        if (b.id) {
          if (b.sort !== undefined) row.sort = b.sort;
          saved = toBranch(must(await sb.from("branches").update(row).eq("id", b.id).select().single()));
        } else {
          row.sort = b.sort ?? Math.max(-1, ...get().branches.map((x) => x.sort)) + 1;
          saved = toBranch(must(await sb.from("branches").insert(row).select().single()));
        }
      } catch (e) {
        if (released.length) await sb.from("branches").update({ is_warehouse: true }).in("id", released);
        throw e;
      }
      await refresh(["branches", "stock"]);
      return saved;
    },

    uploadLogo: async (file) => {
      const ext = LOGO_EXT[file.type];
      if (!ext) throw new Error("El logo debe ser PNG, JPG o WebP");
      if (file.size > 2 * 1024 * 1024) throw new Error("El logo no puede pesar más de 2 MB");
      const path = `${businessId()}/logo-${Date.now()}.${ext}`;
      const bucket = supabase().storage.from(LOGOS_BUCKET);
      const { error } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw new Error(error.message);
      const url = bucket.getPublicUrl(path).data.publicUrl;
      const previous = get().profileSettings.logoUrl;
      try {
        await get().saveProfileSettings({ ...get().profileSettings, logoUrl: url });
      } catch (e) {
        await removeLogoFile(url);
        throw e;
      }
      await removeLogoFile(previous);
      return url;
    },

    removeLogo: async () => {
      const previous = get().profileSettings.logoUrl;
      await get().saveProfileSettings({ ...get().profileSettings, logoUrl: null });
      await removeLogoFile(previous);
    },
  };
});

/* ------------------------------------------------------------------ */
/* Hooks y selectores                                                   */
/* ------------------------------------------------------------------ */
export const useIsOwner = () => useErp((s) => s.role === "dueno");

/** Dueño o encargado: mueven inventario (entradas, ajustes, conteos y traspasos). */
export const useCanMoveStock = () => useErp((s) => s.role === "dueno" || s.role === "encargado");

/** La base aplica la misma regla a cancelar pedidos que a mover inventario. */
export const useCanCancelOrders = useCanMoveStock;

/** Nombre del negocio; mientras carga (o sin sesión) el del producto. */
export const useBusinessName = () => useErp((s) => s.business?.name ?? s.active?.name ?? APP_NAME);

/** Todas las sucursales, también las archivadas (para resolver nombres de datos históricos). */
export const useBranches = () => useErp((s) => s.branches);

/** Sucursales activas, en orden. */
export function useActiveBranches() {
  const branches = useErp((s) => s.branches);
  return useMemo(() => activeBranches(branches), [branches]);
}

/** Sucursales activas con mostrador (Punto de venta). */
export function usePosBranches() {
  const branches = useErp((s) => s.branches);
  return useMemo(() => posBranches(branches), [branches]);
}

/** Sucursal que surte mayoreo y pedidos en línea (puede no haber). */
export const useWarehouse = () => useErp((s) => warehouseOf(s.branches));

/** Nombre corto de una sucursal por id; también resuelve las archivadas. */
export function useBranchName() {
  const branches = useErp((s) => s.branches);
  return useCallback((id: BranchId) => branches.find((b) => b.id === id)?.short ?? id, [branches]);
}

/** Mayoreo disponible: activado en Configuración. */
export const useWholesaleEnabled = () => useErp((s) => s.wholesale.enabled);

/** Canales de venta del negocio; `mayoreo` solo si el módulo de mayoreo está activo. */
export function useChannels(): Channel[] {
  const channels = useErp((s) => s.sales.channels);
  const wholesale = useWholesaleEnabled();
  return useMemo(() => {
    const base = channels.filter((c) => c !== "mayoreo");
    return wholesale ? [...base, "mayoreo"] : base;
  }, [channels, wholesale]);
}

export const useCategories = () => useErp((s) => s.catalog.categories);

/** Mensaje legible de un error lanzado por una acción del store. */
export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Algo salió mal, intenta de nuevo";
}
