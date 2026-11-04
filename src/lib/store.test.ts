import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBranches, currentBranches } from "@/lib/branches";
import {
  applyCatalogSettings,
  applySalesSettings,
  catalogFrom,
  currentCatalog,
  currentSales,
  DEFAULT_CATALOG,
  DEFAULT_PROFILE,
  DEFAULT_SALES,
  paymentFee,
  salesFrom,
  type BusinessProfile,
  type CatalogSettings,
  type SalesSettings,
} from "@/lib/settings";
import { errorMessage, useErp } from "@/lib/store";
import type { Branch, LineItem, Membership, Product, Profile, Quote } from "@/lib/types";
import {
  applyWholesaleSettings,
  DEFAULT_WHOLESALE,
  isWholesaleEnabled,
  TIERS,
  wholesaleSnapshot,
  type WholesaleSettings,
} from "@/lib/wholesale";

/* ------------------------------------------------------------------ */
/* Supabase simulado                                                    */
/* ------------------------------------------------------------------ */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
interface Op {
  method: string;
  args: unknown[];
}
interface Call {
  kind: "table" | "rpc";
  name: string;
  ops: Op[];
  /** Argumentos de la RPC. */
  args?: unknown;
}

const fake = vi.hoisted(() => {
  const calls: Call[] = [];
  const tables: Record<string, Row[]> = {};
  const handlers = new Map<string, (call: Call) => Result | Promise<Result>>();
  const user: { current: { id: string } | null } = { current: { id: "u-1" } };

  const ok = (data: unknown): Result => ({ data, error: null });
  const fail = (message: string): Result => ({ data: null, error: { message } });

  const WRITES = ["insert", "update", "upsert", "delete"];
  const verbOf = (call: Call) => call.ops.find((o) => WRITES.includes(o.method))?.method ?? "select";

  /** Respuesta por defecto de un select: filas de `tables`, con eq/range/limit/single aplicados. */
  function selectRows(call: Call): Result {
    let rows = [...(tables[call.name] ?? [])];
    for (const op of call.ops) {
      if (op.method === "eq") {
        const [column, value] = op.args as [string, unknown];
        rows = rows.filter((r) => r[column] === value);
      }
    }
    const range = call.ops.find((o) => o.method === "range");
    if (range) {
      const [from, to] = range.args as [number, number];
      rows = rows.slice(from, to + 1);
    }
    const limit = call.ops.find((o) => o.method === "limit");
    if (limit) rows = rows.slice(0, limit.args[0] as number);
    if (call.ops.some((o) => o.method === "single")) {
      return rows.length ? ok(rows[0]) : fail("JSON object requested, multiple (or no) rows returned");
    }
    if (call.ops.some((o) => o.method === "maybeSingle")) return ok(rows[0] ?? null);
    return ok(rows);
  }

  /** Registra la llamada al ejecutarse (al hacer await) y devuelve la respuesta configurada. */
  async function run(call: Call): Promise<Result> {
    calls.push(call);
    const key = call.kind === "rpc" ? `rpc.${call.name}` : `${call.name}.${verbOf(call)}`;
    const handler = handlers.get(key);
    if (handler) return handler(call);
    if (call.kind === "table" && verbOf(call) === "select") return selectRows(call);
    return fail(`Sin respuesta configurada para ${key}`);
  }

  class Query implements PromiseLike<Result> {
    readonly call: Call;
    constructor(table: string) {
      this.call = { kind: "table", name: table, ops: [] };
    }
    private add(method: string, args: unknown[]) {
      this.call.ops.push({ method, args });
      return this;
    }
    select(...a: unknown[]) {
      return this.add("select", a);
    }
    eq(...a: unknown[]) {
      return this.add("eq", a);
    }
    neq(...a: unknown[]) {
      return this.add("neq", a);
    }
    in(...a: unknown[]) {
      return this.add("in", a);
    }
    order(...a: unknown[]) {
      return this.add("order", a);
    }
    range(...a: unknown[]) {
      return this.add("range", a);
    }
    limit(...a: unknown[]) {
      return this.add("limit", a);
    }
    insert(...a: unknown[]) {
      return this.add("insert", a);
    }
    update(...a: unknown[]) {
      return this.add("update", a);
    }
    upsert(...a: unknown[]) {
      return this.add("upsert", a);
    }
    delete(...a: unknown[]) {
      return this.add("delete", a);
    }
    single(...a: unknown[]) {
      return this.add("single", a);
    }
    maybeSingle(...a: unknown[]) {
      return this.add("maybeSingle", a);
    }
    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): Promise<T1 | T2> {
      return run(this.call).then(onfulfilled, onrejected);
    }
  }

  class Rpc implements PromiseLike<Result> {
    readonly call: Call;
    constructor(name: string, args?: unknown) {
      this.call = { kind: "rpc", name, ops: [], args };
    }
    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): Promise<T1 | T2> {
      return run(this.call).then(onfulfilled, onrejected);
    }
  }

  interface Listener {
    type: string;
    filter: Row;
    cb: () => void;
  }
  interface FakeChannel {
    name: string;
    listeners: Listener[];
    status?: (status: string) => void;
    on: (type: string, filter: Row, cb: () => void) => FakeChannel;
    subscribe: (cb: (status: string) => void) => FakeChannel;
  }
  const channels: FakeChannel[] = [];

  const PUBLIC_BASE = "https://proyecto.supabase.co/storage/v1/object/public";
  const upload = vi.fn<(path: string, file: unknown, opts: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }));
  const remove = vi.fn<(paths: string[]) => Promise<unknown>>(async () => ({ data: [], error: null }));
  const storageFrom = vi.fn((bucket: string) => ({
    upload,
    remove,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `${PUBLIC_BASE}/${bucket}/${path}` } }),
  }));
  const getUser = vi.fn(async () => ({ data: { user: user.current }, error: null }));
  const signOut = vi.fn(async () => ({ error: null }));
  const removeChannel = vi.fn<(channel: unknown) => Promise<string>>(async () => "ok");

  const client = {
    from: (table: string) => new Query(table),
    rpc: (name: string, args?: unknown) => new Rpc(name, args),
    auth: { getUser, signOut },
    storage: { from: storageFrom },
    channel: (name: string) => {
      const ch: FakeChannel = {
        name,
        listeners: [],
        on: (type, filter, cb) => {
          ch.listeners.push({ type, filter, cb });
          return ch;
        },
        subscribe: (cb) => {
          ch.status = cb;
          return ch;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel,
  };

  function reset() {
    calls.length = 0;
    for (const k of Object.keys(tables)) delete tables[k];
    handlers.clear();
    channels.length = 0;
    user.current = { id: "u-1" };
    upload.mockClear();
    remove.mockClear();
    storageFrom.mockClear();
    getUser.mockClear();
    signOut.mockClear();
    removeChannel.mockClear();
    upload.mockImplementation(async () => ({ error: null }));
    remove.mockImplementation(async () => ({ data: [], error: null }));
  }

  return {
    PUBLIC_BASE,
    calls,
    tables,
    user,
    channels,
    client,
    ok,
    fail,
    verbOf,
    reset,
    upload,
    remove,
    signOut,
    removeChannel,
    /** Configura la respuesta de `tabla.verbo` (select/insert/update/upsert/delete) o `rpc.nombre`. */
    on: (key: string, handler: (call: Call) => Result | Promise<Result>) => {
      handlers.set(key, handler);
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ supabase: () => fake.client }));

const { ok, fail } = fake;

const rpcCalls = (name: string) => fake.calls.filter((c) => c.kind === "rpc" && c.name === name);
const tableCalls = (name: string, verb = "select") => fake.calls.filter((c) => c.kind === "table" && c.name === name && fake.verbOf(c) === verb);
const opArgs = (call: Call, method: string) => call.ops.find((o) => o.method === method)?.args;
const methods = (call: Call) => call.ops.map((o) => o.method);
const onlyRpc = (name: string) => {
  const found = rpcCalls(name);
  expect(found).toHaveLength(1);
  return found[0];
};

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */
const BUSINESS_ID = "b-1";
const PROFILE: Profile = {
  id: "u-1",
  businessId: BUSINESS_ID,
  name: "Ana Dueña",
  email: "ana@boutique.mx",
  role: "dueno",
  branch: null,
  createdAt: "2026-01-01T00:00:00Z",
};

const MEMBERSHIP: Membership = {
  state: "prueba",
  trialEndsAt: "2026-03-15T00:00:00Z",
  paidUntil: null,
  graceEndsAt: null,
  suspendedReason: null,
  priceMonthly: 1199,
  priceSetup: 3599,
  payment: { bank: "BBVA", clabe: "012180001234567899", holder: "Plataforma", whatsapp: "3310000000" },
};

const profileRow = (patch: Row = {}): Row => ({
  id: "u-1",
  name: "Ana Dueña",
  email: "ana@boutique.mx",
  created_at: "2026-01-01T00:00:00Z",
  active_business_id: BUSINESS_ID,
  ...patch,
});

/** Fila de `business_members`: el rol y la sucursal viven aquí, no en `profiles`. */
const memberRow = (patch: Row = {}): Row => ({
  user_id: "u-1",
  business_id: BUSINESS_ID,
  role: "dueno",
  branch: null,
  created_at: "2026-01-01T00:00:00Z",
  ...patch,
});

/** Fila de `my_businesses()` del negocio activo. */
const ownBusiness = (patch: Row = {}): Row => ({
  id: BUSINESS_ID,
  name: "Boutique Aurora",
  kind: "boutique",
  role: "dueno",
  state: "prueba",
  endsAt: null,
  rejectionReason: null,
  monthSales: 0,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  ...patch,
});

const businessRow = (patch: Row = {}): Row => ({
  id: BUSINESS_ID,
  name: "Boutique Aurora",
  kind: "boutique",
  invite_code: "ABCD2345",
  order_prefix: "V-",
  quote_prefix: "COT-",
  ...patch,
});

const branchRow = (patch: Row = {}): Row => ({
  id: "br-1",
  name: "Sucursal Centro",
  short: "Centro",
  address: "Calle 1",
  pos: true,
  is_warehouse: true,
  active: true,
  sort: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...patch,
});

const branch = (patch: Partial<Branch> = {}): Branch => ({
  id: "br-1",
  name: "Sucursal Centro",
  short: "Centro",
  address: "Calle 1",
  pos: true,
  isWarehouse: false,
  active: true,
  sort: 0,
  ...patch,
});

const ITEM: LineItem = {
  productId: "p-1",
  variantKey: "p-1|Rojo|S",
  name: "Vestido lino",
  color: "Rojo",
  size: "S",
  qty: 2,
  unitPrice: 250,
  unitCost: 120,
  listPrice: 250,
};

/** Como llegan los renglones de la BD: sin costo, que vive en `order_costs`/`product_costs`. */
const ITEM_ROW = Object.fromEntries(Object.entries(ITEM).filter(([k]) => k !== "unitCost"));

const orderRow = (patch: Row = {}): Row => ({
  id: "o-1",
  folio: "V-1001",
  date: "2026-03-01T10:00:00Z",
  channel: "tienda",
  customer_id: null,
  customer_name: "Mostrador",
  branch: "br-1",
  items: [ITEM_ROW],
  subtotal: "500.00",
  discount: "0",
  shipping: "0",
  total: "500.00",
  payments: [{ id: "pay-1", date: "2026-03-01T10:00:00Z", amount: "500.00", method: "efectivo" }],
  status: "pagado",
  shipping_info: null,
  notes: null,
  quote_id: null,
  tier_id: null,
  seller: "Ana Dueña",
  pickup: false,
  ...patch,
});

const quoteRow = (patch: Row = {}): Row => ({
  id: "q-1",
  folio: "COT-0001",
  date: "2026-03-02T10:00:00Z",
  valid_until: "2026-03-09T10:00:00Z",
  customer_id: "c-1",
  customer_name: "Lupita",
  items: [ITEM_ROW],
  tier_id: "mayor",
  subtotal_list: "1000",
  discount: "200",
  subtotal: "800",
  shipping: "250",
  total: "1050",
  deposit_pct: "0.5",
  status: "borrador",
  notes: null,
  order_id: null,
  ...patch,
});

const productRow = (patch: Row = {}): Row => ({
  id: "p-1",
  sku: "VES-01",
  name: "Vestido lino",
  brand: "Aurora",
  category: "Vestidos",
  price: "349.00",
  sizes: ["S", "M"],
  colors: [{ name: "Rojo", hex: "#ff0000" }],
  min_stock: 2,
  active: true,
  created_at: "2026-02-01T00:00:00Z",
  woo_id: null,
  ...patch,
});

const customerRow = (patch: Row = {}): Row => ({
  id: "c-1",
  name: "Lupita",
  business: null,
  phone: "5551234567",
  city: "CDMX",
  state: "CDMX",
  type: "menudeo",
  instagram: null,
  rfc: null,
  email: null,
  since: "2026-02-10T00:00:00Z",
  notes: null,
  ...patch,
});

const expenseRow = (patch: Row = {}): Row => ({
  id: "e-1",
  date: "2026-03-05T00:00:00Z",
  category: "renta",
  description: "Renta marzo",
  amount: "8000.00",
  branch: null,
  method: "transferencia",
  ...patch,
});

const SETTINGS_ROWS: Row[] = [
  { business_id: BUSINESS_ID, key: "profile", value: { legalName: "Aurora SA", accentColor: "#aa5500", logoUrl: null } },
  {
    business_id: BUSINESS_ID,
    key: "catalog",
    value: { categories: ["Vestidos", "Faldas"], sizePresets: [{ name: "Unitalla", sizes: ["Única"] }], sizeCurve: { S: 0.5, M: 0.5 } },
  },
  { business_id: BUSINESS_ID, key: "sales", value: { channels: ["tienda", "whatsapp"], carriers: ["DHL"], paymentFees: { tarjeta: 0.05 } } },
  {
    business_id: BUSINESS_ID,
    key: "wholesale",
    value: {
      enabled: true,
      // fuera de orden a propósito: la configuración vigente los ordena por piezas
      tiers: [
        { id: "dist", name: "Distribuidor", minPieces: 24, discount: 0.3, description: "24+ piezas" },
        { id: "lista", name: "Lista", minPieces: 1, discount: 0, description: "Precio de lista" },
        { id: "mayor", name: "Mayoreo", minPieces: 6, discount: 0.2, description: "6+ piezas" },
      ],
      distributorCustomerMin: 50,
      depositPct: 0.5,
      freeShippingFrom: 5000,
      flatShipping: 250,
      validityDays: 10,
      packages: [],
      bank: { bank: "BBVA", holder: "Aurora SA", clabe: "012345678901234567" },
    },
  },
  // configuración de otro negocio: nunca debe mezclarse
  { business_id: "b-otro", key: "sales", value: { channels: ["web"] } },
];

/** Datos completos de un dueño con negocio configurado. */
function seedOwner() {
  fake.tables.profiles = [profileRow()];
  fake.tables.business_members = [memberRow()];
  fake.on("rpc.my_businesses", () => ok([ownBusiness()]));
  fake.on("rpc.my_membership", () => ok(MEMBERSHIP));
  fake.tables.businesses = [businessRow()];
  fake.tables.branches = [
    branchRow(),
    // sort llega como texto numérico y address como null
    branchRow({ id: "br-2", name: "Sucursal Norte", short: "Norte", address: null, is_warehouse: false, sort: "1" }),
    branchRow({ id: "br-3", short: "Vieja", is_warehouse: false, active: false, sort: 2 }),
  ];
  fake.tables.settings = SETTINGS_ROWS;
  fake.tables.products = [productRow()];
  fake.tables.product_costs = [{ product_id: "p-1", cost: "120.50" }];
  fake.tables.order_costs = [{ order_id: "o-1", costs: { "p-1|Rojo|S": 120 } }];
  fake.tables.stock = [
    { variant_key: "p-1|Rojo|S", branch: "br-1", qty: 4 },
    { variant_key: "p-1|Rojo|S", branch: "br-2", qty: 1 },
  ];
  fake.tables.movements = [{ id: "m-1", date: "2026-03-01T10:00:00Z", type: "venta", product_id: "p-1", variant_key: "p-1|Rojo|S", branch: "br-1", qty: -1, ref: "V-1001", note: null }];
  fake.tables.orders = [orderRow()];
  fake.tables.customers = [customerRow()];
  fake.tables.quotes = [quoteRow()];
  fake.tables.expenses = [expenseRow()];
}

/** Deja el store como si ya hubiera iniciado sesión el dueño. */
function signIn(patch: Partial<Profile> = {}) {
  useErp.setState({ profile: { ...PROFILE, ...patch }, role: "dueno", status: "ready" });
}

const state = () => useErp.getState();

/* ------------------------------------------------------------------ */
/* Aislamiento entre pruebas                                            */
/* ------------------------------------------------------------------ */
const INITIAL = useErp.getState();
const assign = vi.fn();

beforeEach(() => {
  fake.reset();
  assign.mockReset();
  vi.stubGlobal("window", { location: { assign } });
  // configuración de módulo vigente (variables de módulo que el store aplica al cargar y guardar)
  applyBranches([]);
  applyCatalogSettings(catalogFrom(undefined));
  applySalesSettings(salesFrom(undefined));
  applyWholesaleSettings(DEFAULT_WHOLESALE);
  useErp.setState(INITIAL, true);
});

afterEach(async () => {
  vi.useRealTimers();
  // suelta el canal de tiempo real que haya dejado `init` (variable de módulo del store)
  await state().signOut();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* init                                                                 */
/* ------------------------------------------------------------------ */
describe("init", () => {
  it("con sesión de dueño carga negocio, perfil y sucursales", async () => {
    seedOwner();
    await state().init();

    const s = state();
    expect(s.status).toBe("ready");
    expect(s.error).toBeUndefined();
    expect(s.role).toBe("dueno");
    expect(s.profile).toEqual(PROFILE);
    expect(s.kind).toBe("boutique");
    expect(s.business).toEqual({ id: BUSINESS_ID, name: "Boutique Aurora", kind: "boutique", inviteCode: "ABCD2345", orderPrefix: "V-", quotePrefix: "COT-" });
    expect(s.branches.map((b) => b.id)).toEqual(["br-1", "br-2", "br-3"]);
    expect(s.branches[0]).toEqual(branch({ isWarehouse: true }));
    // address null -> "" y sort como texto -> número
    expect(s.branches[1]).toEqual(branch({ id: "br-2", name: "Sucursal Norte", short: "Norte", address: "", sort: 1 }));
    expect(s.branches[2].active).toBe(false);
  });

  it("convierte las filas de Postgres a los tipos de la app", async () => {
    seedOwner();
    await state().init();
    const s = state();

    expect(s.products[0]).toEqual({
      id: "p-1",
      sku: "VES-01",
      name: "Vestido lino",
      brand: "Aurora",
      category: "Vestidos",
      cost: 120.5,
      price: 349,
      sizes: ["S", "M"],
      colors: [{ name: "Rojo", hex: "#ff0000" }],
      minStock: 2,
      active: true,
      createdAt: "2026-02-01T00:00:00Z",
      wooId: undefined,
    });
    expect(s.stock).toEqual({ "p-1|Rojo|S": { "br-1": 4, "br-2": 1 } });
    expect(s.movements[0]).toMatchObject({ productId: "p-1", variantKey: "p-1|Rojo|S", qty: -1, ref: "V-1001", note: undefined });
    expect(s.orders[0]).toMatchObject({ folio: "V-1001", total: 500, subtotal: 500, customerId: undefined, shippingInfo: undefined, seller: "Ana Dueña" });
    expect(s.orders[0].payments[0].amount).toBe(500);
    expect(s.orders[0]).toMatchObject({ pickup: false });
    expect(s.customers[0]).toMatchObject({ name: "Lupita", business: undefined, instagram: undefined, type: "menudeo" });
    expect(s.quotes[0]).toMatchObject({ folio: "COT-0001", validUntil: "2026-03-09T10:00:00Z", subtotalList: 1000, depositPct: 0.5, tierId: "mayor" });
    expect(s.expenses[0]).toMatchObject({ amount: 8000, branch: undefined, category: "renta" });
  });

  it("carga las configuraciones del negocio y las aplica al módulo", async () => {
    seedOwner();
    await state().init();
    const s = state();

    expect(s.profileSettings).toEqual({ ...DEFAULT_PROFILE, legalName: "Aurora SA", accentColor: "#aa5500" });
    expect(s.catalog.categories).toEqual(["Vestidos", "Faldas"]);
    expect(s.catalog.sizeCurve).toEqual({ S: 0.5, M: 0.5 });
    expect(s.sales.channels).toEqual(["tienda", "whatsapp"]);
    expect(s.sales.paymentFees).toEqual({ ...DEFAULT_SALES.paymentFees, tarjeta: 0.05 });

    // los helpers que no son hooks leen lo vigente
    expect(currentBranches()).toBe(s.branches);
    expect(currentCatalog()).toBe(s.catalog);
    expect(currentSales()).toBe(s.sales);
    expect(paymentFee("tarjeta")).toBe(0.05);
    expect(paymentFee("efectivo")).toBe(0);
    expect(isWholesaleEnabled()).toBe(true);
    expect(TIERS.map((t) => t.id)).toEqual(["lista", "mayor", "dist"]);
    expect(s.wholesale.enabled).toBe(true);
    expect(s.wholesale).toEqual(wholesaleSnapshot());
    expect(s.wholesale.depositPct).toBe(0.5);
    expect(s.wholesale.bank.clabe).toBe("012345678901234567");
  });

  it("sin filas en settings usa los valores neutros del contrato", async () => {
    // estado previo distinto de los defaults: init debe sustituirlo
    applyWholesaleSettings({ ...DEFAULT_WHOLESALE, enabled: true });
    applyCatalogSettings({ categories: ["Otra"], sizePresets: [], sizeCurve: {} });
    seedOwner();
    fake.tables.settings = [];
    await state().init();
    const s = state();

    expect(s.profileSettings).toEqual(DEFAULT_PROFILE);
    expect(s.catalog).toEqual(DEFAULT_CATALOG);
    expect(s.sales).toEqual(DEFAULT_SALES);
    expect(s.wholesale).toEqual(DEFAULT_WHOLESALE);
    expect(isWholesaleEnabled()).toBe(false);
    expect(TIERS.map((t) => t.id)).toEqual(["lista"]);
    expect(currentCatalog().categories).toEqual(DEFAULT_CATALOG.categories);
    expect(currentSales().channels).toEqual(["tienda", "web", "instagram", "whatsapp"]);
    expect(s.profileSettings.ticketFooter).toBe("¡Gracias por tu compra!");
  });

  it("solo lee la configuración del negocio en sesión", async () => {
    seedOwner();
    await state().init();
    const call = tableCalls("settings")[0];
    expect(opArgs(call, "select")).toEqual(["key, value"]);
    expect(opArgs(call, "eq")).toEqual(["business_id", BUSINESS_ID]);
    // la fila de "b-otro" no se mezcla
    expect(state().sales.channels).not.toContain("web");
  });

  it("consulta perfil y negocio por id, y todas las tablas de datos", async () => {
    seedOwner();
    await state().init();
    const queried = new Set(fake.calls.filter((c) => c.kind === "table").map((c) => c.name));
    expect(queried).toEqual(new Set(["profiles", "business_members", "businesses", "products", "product_costs", "stock", "movements", "orders", "order_costs", "customers", "quotes", "expenses", "branches", "settings"]));
    expect(opArgs(tableCalls("profiles")[0], "eq")).toEqual(["id", "u-1"]);
    expect(opArgs(tableCalls("businesses")[0], "eq")).toEqual(["id", BUSINESS_ID]);
  });

  it("ordena las consultas y limita el kardex a 1000 movimientos", async () => {
    seedOwner();
    await state().init();
    const orders = (table: string) => tableCalls(table)[0].ops.filter((o) => o.method === "order").map((o) => o.args);
    expect(orders("products")).toEqual([["created_at", { ascending: true }], ["id", { ascending: true }]]);
    expect(orders("orders")).toEqual([["date", { ascending: true }], ["id", { ascending: true }]]);
    expect(orders("customers")).toEqual([["since", { ascending: true }], ["id", { ascending: true }]]);
    expect(orders("quotes")).toEqual([["date", { ascending: true }], ["id", { ascending: true }]]);
    expect(orders("expenses")).toEqual([["date", { ascending: false }], ["id", { ascending: true }]]);
    expect(orders("branches")).toEqual([
      ["sort", { ascending: true }],
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(orders("stock")).toEqual([["variant_key", { ascending: true }], ["branch", { ascending: true }]]);
    expect(orders("movements")).toEqual([["date", { ascending: false }]]);
    expect(opArgs(tableCalls("movements")[0], "limit")).toEqual([1000]);
  });

  it("pagina de 1000 en 1000 para traer todas las filas", async () => {
    seedOwner();
    fake.tables.products = Array.from({ length: 1005 }, (_, i) => productRow({ id: `p-${i}`, sku: `SKU-${i}` }));
    await state().init();

    expect(state().products).toHaveLength(1005);
    const pages = tableCalls("products").map((c) => opArgs(c, "range"));
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("se suscribe una sola vez al canal con las 8 tablas del contrato (más las de costos si es dueño) y refleja el estado en live", async () => {
    seedOwner();
    await state().init();
    await state().init();

    expect(fake.channels).toHaveLength(1);
    const [ch] = fake.channels;
    expect(ch.name).toBe("erp");
    expect(ch.listeners.map((l) => l.filter.table)).toEqual(["orders", "stock", "quotes", "customers", "products", "expenses", "branches", "settings", "product_costs", "order_costs"]);
    expect(ch.listeners.every((l) => l.type === "postgres_changes" && l.filter.schema === "public" && l.filter.event === "*")).toBe(true);

    expect(state().live).toBe(false);
    ch.status?.("SUBSCRIBED");
    expect(state().live).toBe(true);
    ch.status?.("CLOSED");
    expect(state().live).toBe(false);
  });

  it("una cuenta de dueño sin negocio activo queda lista sin cargar nada", async () => {
    fake.tables.profiles = [profileRow({ active_business_id: null })];
    await state().init();
    const s = state();

    expect(s.status).toBe("ready");
    expect(s.profile).toMatchObject({ businessId: null, role: "dueno" });
    expect(s.active).toBeNull();
    expect(s.business).toBeNull();
    expect(fake.calls.map((c) => c.name)).toEqual(["profiles"]);
    expect(fake.channels).toHaveLength(0);
  });

  it("en restaurante toma el giro y el rol de la membresía y no carga ni escucha tablas de boutique", async () => {
    seedOwner();
    fake.tables.business_members = [memberRow({ role: "cajero" })];
    fake.on("rpc.my_businesses", () => ok([ownBusiness({ kind: "restaurante", role: "cajero" })]));
    await state().init();
    const s = state();

    expect(s.status).toBe("ready");
    expect(s.kind).toBe("restaurante");
    expect(s.role).toBe("cajero");
    expect(s.active?.name).toBe("Boutique Aurora");
    expect(new Set(fake.calls.filter((c) => c.kind === "table").map((c) => c.name))).toEqual(new Set(["profiles", "business_members"]));
    expect(s.products).toEqual([]);
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0].listeners).toHaveLength(0);
  });

  it("switchBusiness activa el negocio, reinicia el store y el canal realtime y vuelve a cargar", async () => {
    seedOwner();
    await state().init();
    const first = fake.channels[0];
    expect(state().products).toHaveLength(1);

    fake.on("rpc.set_active_business", () => ok(null));
    fake.tables.profiles = [profileRow({ active_business_id: "b-2" })];
    fake.tables.business_members = [memberRow({ business_id: "b-2", role: "dueno" })];
    fake.tables.businesses = [businessRow({ id: "b-2", name: "Café Aurora", kind: "restaurante" })];
    fake.on("rpc.my_businesses", () => ok([ownBusiness({ id: "b-2", name: "Café Aurora", kind: "restaurante" })]));
    await state().switchBusiness("b-2");

    expect(onlyRpc("set_active_business").args).toEqual({ p_id: "b-2" });
    expect(fake.removeChannel).toHaveBeenCalledWith(first);
    expect(state().kind).toBe("restaurante");
    expect(state().active?.name).toBe("Café Aurora");
    // nada del negocio anterior queda en memoria
    expect(state().products).toEqual([]);
    expect(state().business?.id).toBe("b-2");
    expect(state().status).toBe("ready");
  });

  it("switchBusiness propaga el error y no toca el store", async () => {
    seedOwner();
    await state().init();
    fake.on("rpc.set_active_business", () => fail("Negocio no encontrado"));
    await expect(state().switchBusiness("x")).rejects.toThrow("Negocio no encontrado");
    expect(state().products).toHaveLength(1);
  });

  it("reset suelta datos y canal", async () => {
    seedOwner();
    await state().init();
    await state().reset();
    expect(state().status).toBe("loading");
    expect(state().profile).toBeNull();
    expect(state().products).toEqual([]);
    expect(state().live).toBe(false);
  });

  it("un usuario pendiente queda listo sin cargar datos del negocio", async () => {
    fake.tables.profiles = [profileRow()];
    fake.tables.business_members = [memberRow({ role: "pendiente" })];
    fake.on("rpc.my_businesses", () => ok([ownBusiness({ role: "pendiente", kind: "restaurante", name: "Café Aurora" })]));
    await state().init();
    const s = state();

    expect(s.status).toBe("ready");
    expect(s.role).toBe("vendedor");
    expect(s.profile?.role).toBe("pendiente");
    expect(s.business).toBeNull();
    expect(s.branches).toEqual([]);
    expect(s.products).toEqual([]);
    expect(s.active).toMatchObject({ name: "Café Aurora", kind: "restaurante" });
    expect(fake.calls.map((c) => c.name)).toEqual(["profiles", "business_members", "my_businesses"]);
    expect(fake.channels).toHaveLength(0);
  });

  it("un vendedor aprobado recibe el rol vendedor y carga sus datos", async () => {
    seedOwner();
    fake.tables.business_members = [memberRow({ role: "vendedor", branch: "br-1" })];
    await state().init();
    expect(state().role).toBe("vendedor");
    expect(state().profile?.branch).toBe("br-1");
    expect(state().business?.id).toBe(BUSINESS_ID);
  });

  it("un vendedor no consulta ni escucha los costos y los ve en 0", async () => {
    seedOwner();
    fake.tables.business_members = [memberRow({ role: "vendedor", branch: "br-1" })];
    await state().init();

    const queried = new Set(fake.calls.map((c) => c.name));
    expect(queried).not.toContain("product_costs");
    expect(queried).not.toContain("order_costs");
    expect(state().products[0].cost).toBe(0);
    expect(state().orders[0].items[0].unitCost).toBe(0);
    expect(state().quotes[0].items[0].unitCost).toBe(0);
    expect(fake.channels[0].listeners.map((l) => l.filter.table)).toEqual(["orders", "stock", "quotes", "customers", "products", "expenses", "branches", "settings"]);
  });

  it("el dueño fusiona product_costs en productos y cotizaciones, y order_costs en pedidos (0 si falta)", async () => {
    seedOwner();
    fake.tables.products = [productRow(), productRow({ id: "p-2", sku: "FAL-01" })];
    fake.tables.orders = [orderRow(), orderRow({ id: "o-2", items: [{ ...ITEM_ROW, variantKey: "otra" }] }), orderRow({ id: "o-3" })];
    fake.tables.order_costs = [{ order_id: "o-1", costs: { "p-1|Rojo|S": "120" } }, { order_id: "o-2", costs: {} }];
    await state().init();

    expect(state().products.map((p) => p.cost)).toEqual([120.5, 0]);
    expect(state().orders.map((o) => o.items[0].unitCost)).toEqual([120, 0, 0]);
    expect(state().quotes[0].items[0].unitCost).toBe(120.5);
    expect(tableCalls("product_costs")[0].ops.filter((o) => o.method === "order").map((o) => o.args)).toEqual([["product_id", { ascending: true }]]);
    expect(tableCalls("order_costs")[0].ops.filter((o) => o.method === "order").map((o) => o.args)).toEqual([["order_id", { ascending: true }]]);
  });

  it("sin sesión redirige a /login y no consulta nada", async () => {
    fake.user.current = null;
    await state().init();

    expect(assign).toHaveBeenCalledWith("/login");
    expect(fake.calls).toHaveLength(0);
    expect(state().profile).toBeNull();
    expect(state().status).toBe("loading");
  });

  it("si falla la consulta del perfil deja el estado en error con el mensaje", async () => {
    fake.on("profiles.select", () => fail("JWT expired"));
    await state().init();
    expect(state().status).toBe("error");
    expect(state().error).toBe("JWT expired");
    expect(assign).not.toHaveBeenCalled();
  });

  it("si falla una tabla deja el estado en error y no se suscribe", async () => {
    seedOwner();
    fake.on("orders.select", () => fail("permission denied for table orders"));
    await state().init();
    expect(state().status).toBe("error");
    expect(state().error).toBe("permission denied for table orders");
    expect(fake.channels).toHaveLength(0);
  });

  it("guarda la membresía", async () => {
    seedOwner();
    await state().init();
    expect(state().membership).toEqual(MEMBERSHIP);
  });

  it.each([
    ["suspendida", "Falta de pago"],
    ["vencida", null],
  ] as const)("una cuenta %s queda lista sin cargar tablas ni suscribirse", async (blocked, reason) => {
    seedOwner();
    fake.on("rpc.my_membership", () => ok({ ...MEMBERSHIP, state: blocked, suspendedReason: reason }));
    await state().init();

    expect(state().status).toBe("ready");
    expect(state().membership?.state).toBe(blocked);
    expect(state().membership?.suspendedReason).toBe(reason);
    expect(state().business).toBeNull();
    expect(state().products).toEqual([]);
    expect(new Set(fake.calls.map((c) => c.name))).toEqual(new Set(["profiles", "business_members", "my_businesses", "my_membership"]));
    expect(fake.channels).toHaveLength(0);
  });

  it("al reintentar limpia el error anterior", async () => {
    useErp.setState({ status: "error", error: "viejo" });
    seedOwner();
    await state().init();
    expect(state().status).toBe("ready");
    expect(state().error).toBeUndefined();
  });
});

describe("cuenta bloqueada durante la sesión", () => {
  it.each([
    ["Cuenta suspendida", "suspendida"],
    ["Membresía vencida", "vencida"],
  ] as const)("el error '%s' de cualquier acción vuelve a correr init", async (message, blocked) => {
    seedOwner();
    signIn();
    fake.on("rpc.add_payment", () => fail(message));
    fake.on("rpc.my_membership", () => ok({ ...MEMBERSHIP, state: blocked }));

    await expect(state().addPayment("o-1", { method: "efectivo", amount: 10 })).rejects.toThrow(message);
    await vi.waitFor(() => expect(state().membership?.state).toBe(blocked));
    expect(state().status).toBe("ready");
    expect(rpcCalls("my_membership")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* reload, realtime y signOut                                           */
/* ------------------------------------------------------------------ */
describe("reload y tiempo real", () => {
  it("reload exige una sesión activa", async () => {
    await expect(state().reload(["orders"])).rejects.toThrow("No hay una sesión activa");
    expect(fake.calls).toHaveLength(0);
  });

  it("reload solo consulta las tablas pedidas y actualiza el estado", async () => {
    signIn();
    fake.tables.customers = [customerRow(), customerRow({ id: "c-2", name: "Marta" })];
    await state().reload(["customers"]);
    expect(fake.calls.map((c) => c.name)).toEqual(["customers"]);
    expect(state().customers.map((c) => c.name)).toEqual(["Lupita", "Marta"]);
  });

  it("agrupa una ráfaga de eventos y recarga la tabla 300 ms después", async () => {
    seedOwner();
    await state().init();
    const listener = fake.channels[0].listeners.find((l) => l.filter.table === "orders");
    if (!listener) throw new Error("sin listener de orders");
    fake.calls.length = 0;

    vi.useFakeTimers();
    listener.cb();
    listener.cb();
    listener.cb();
    await vi.advanceTimersByTimeAsync(299);
    expect(tableCalls("orders")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tableCalls("orders")).toHaveLength(1);
  });

  it("un cambio en stock recarga también el kardex", async () => {
    seedOwner();
    await state().init();
    const listener = fake.channels[0].listeners.find((l) => l.filter.table === "stock");
    if (!listener) throw new Error("sin listener de stock");
    fake.calls.length = 0;
    fake.tables.stock = [{ variant_key: "p-1|Rojo|S", branch: "br-1", qty: 9 }];

    vi.useFakeTimers();
    listener.cb();
    await vi.advanceTimersByTimeAsync(300);
    expect(new Set(fake.calls.map((c) => c.name))).toEqual(new Set(["stock", "movements"]));
    expect(state().stock["p-1|Rojo|S"]).toEqual({ "br-1": 9 });
  });

  it("un cambio en product_costs recarga productos y cotizaciones; en order_costs, pedidos", async () => {
    seedOwner();
    await state().init();
    const listener = (table: string) => {
      const l = fake.channels[0].listeners.find((x) => x.filter.table === table);
      if (!l) throw new Error(`sin listener de ${table}`);
      return l;
    };
    fake.calls.length = 0;

    vi.useFakeTimers();
    listener("product_costs").cb();
    await vi.advanceTimersByTimeAsync(300);
    expect(tableCalls("products")).toHaveLength(1);
    expect(tableCalls("quotes")).toHaveLength(1);
    expect(tableCalls("orders")).toHaveLength(0);

    fake.calls.length = 0;
    listener("order_costs").cb();
    await vi.advanceTimersByTimeAsync(300);
    expect(tableCalls("orders")).toHaveLength(1);
    expect(tableCalls("products")).toHaveLength(0);
  });

  it("si la recarga por evento falla no lanza ni cambia el estado", async () => {
    seedOwner();
    await state().init();
    const listener = fake.channels[0].listeners.find((l) => l.filter.table === "orders");
    if (!listener) throw new Error("sin listener de orders");
    fake.on("orders.select", () => fail("sin red"));

    vi.useFakeTimers();
    listener.cb();
    await vi.advanceTimersByTimeAsync(300);
    expect(state().orders).toHaveLength(1);
    expect(state().status).toBe("ready");
  });

  it("signOut cierra el canal, cierra la sesión y manda a /login", async () => {
    seedOwner();
    await state().init();
    const [ch] = fake.channels;
    await state().signOut();

    expect(fake.removeChannel).toHaveBeenCalledWith(ch);
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login");

    // sin canal activo ya no intenta quitarlo
    fake.removeChannel.mockClear();
    await state().signOut();
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Operaciones atómicas (RPC)                                           */
/* ------------------------------------------------------------------ */
describe("pedidos", () => {
  const input = {
    channel: "tienda" as const,
    customerName: "Mostrador",
    branch: "br-1",
    items: [ITEM],
    payments: [{ amount: 500, method: "efectivo" as const }],
  };

  beforeEach(() => {
    signIn();
  });

  it("createOrder llama create_order con un único parámetro p y el vendedor en sesión", async () => {
    fake.on("rpc.create_order", () => ok(orderRow()));
    await state().createOrder(input);

    const call = onlyRpc("create_order");
    expect(call.args).toEqual({ p: { ...input, seller: "Ana Dueña" } });
    expect(Object.keys(call.args as object)).toEqual(["p"]);
  });

  it("createOrder respeta el vendedor indicado y manda las llaves camelCase que lee la función SQL", async () => {
    fake.on("rpc.create_order", () => ok(orderRow()));
    await state().createOrder({
      ...input,
      customerId: "c-1",
      discount: 50,
      shipping: 120,
      status: "pendiente",
      notes: "regalo",
      shippingInfo: { carrier: "DHL", city: "Puebla" },
      tierId: "mayor",
      quoteId: "q-1",
      seller: "Beto",
    });
    const p = (onlyRpc("create_order").args as { p: Row }).p;
    expect(Object.keys(p).sort()).toEqual(
      ["branch", "channel", "customerId", "customerName", "discount", "items", "notes", "payments", "quoteId", "seller", "shipping", "shippingInfo", "status", "tierId"].sort(),
    );
    expect(p.seller).toBe("Beto");
  });

  it("createOrder manda pickup tal cual y el pedido devuelto lo lee (false por defecto)", async () => {
    fake.on("rpc.create_order", () => ok(orderRow({ pickup: true })));
    const order = await state().createOrder({ ...input, pickup: true });
    expect((onlyRpc("create_order").args as { p: Row }).p.pickup).toBe(true);
    expect(order.pickup).toBe(true);

    fake.on("rpc.add_payment", () => ok({ ...orderRow(), pickup: undefined }));
    await state().addPayment("o-1", { amount: 1, method: "efectivo" });
    expect(state().orders[0].pickup).toBe(false);
  });

  it("createOrder devuelve el pedido, lo guarda y recarga existencias y kardex", async () => {
    fake.on("rpc.create_order", () => ok(orderRow({ id: "o-9", folio: "V-1009" })));
    fake.tables.stock = [{ variant_key: "p-1|Rojo|S", branch: "br-1", qty: 2 }];
    fake.tables.movements = [{ id: "m-9", date: "2026-03-01T10:00:00Z", type: "venta", product_id: "p-1", variant_key: "p-1|Rojo|S", branch: "br-1", qty: -2, ref: "V-1009" }];

    const order = await state().createOrder(input);

    expect(order).toMatchObject({ id: "o-9", folio: "V-1009", total: 500 });
    expect(state().orders.map((o) => o.id)).toEqual(["o-9"]);
    expect(state().stock).toEqual({ "p-1|Rojo|S": { "br-1": 2 } });
    expect(state().movements.map((m) => m.id)).toEqual(["m-9"]);
    expect(tableCalls("stock")).toHaveLength(1);
    expect(tableCalls("movements")).toHaveLength(1);
  });

  it("createOrder propaga el error de Postgres y no toca el estado", async () => {
    fake.on("rpc.create_order", () => fail("Sin existencia suficiente: Vestido lino Rojo talla S (hay 1)"));
    const err = await state()
      .createOrder(input)
      .catch((e: unknown) => e);

    expect(errorMessage(err)).toBe("Sin existencia suficiente: Vestido lino Rojo talla S (hay 1)");
    expect(state().orders).toEqual([]);
    expect(tableCalls("stock")).toHaveLength(0);
  });

  it("createOrder no duplica un pedido que ya está en el estado", async () => {
    fake.on("rpc.create_order", () => ok(orderRow()));
    await state().createOrder(input);
    fake.on("rpc.create_order", () => ok(orderRow({ status: "enviado" })));
    await state().createOrder(input);
    expect(state().orders).toHaveLength(1);
    expect(state().orders[0].status).toBe("enviado");
  });

  it("createOrder resuelve con el pedido aunque falle la recarga de existencias", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.on("rpc.create_order", () => ok(orderRow()));
    fake.on("stock.select", () => fail("sin red"));
    const order = await state().createOrder(input);
    expect(order.id).toBe("o-1");
    expect(state().orders).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  it("addPayment llama add_payment con p_order y p_payment y reemplaza el pedido en el estado", async () => {
    fake.tables.orders = [orderRow({ status: "pendiente", total: "900", payments: [] })];
    await state().reload(["orders"]);
    fake.on(
      "rpc.add_payment",
      () => ok(orderRow({ status: "apartado", total: "900", payments: [{ id: "pay-2", date: "2026-03-02T00:00:00Z", amount: "200", method: "tarjeta" }] })),
    );

    await state().addPayment("o-1", { amount: 200, method: "tarjeta" });

    expect(onlyRpc("add_payment").args).toEqual({ p_order: "o-1", p_payment: { amount: 200, method: "tarjeta" } });
    expect(state().orders).toHaveLength(1);
    expect(state().orders[0]).toMatchObject({ id: "o-1", status: "apartado", total: 900 });
    expect(state().orders[0].payments[0].amount).toBe(200);
  });

  it("addPayment propaga 'Monto inválido' y deja los pedidos intactos", async () => {
    fake.on("rpc.add_payment", () => fail("Monto inválido"));
    await expect(state().addPayment("o-1", { amount: 0, method: "efectivo" })).rejects.toThrow("Monto inválido");
    expect(state().orders).toEqual([]);
  });

  it("setOrderStatus llama set_order_status con p_order, p_status y p_shipping", async () => {
    fake.on("rpc.set_order_status", () => ok(orderRow({ status: "enviado", shipping_info: { carrier: "DHL", tracking: "123" } })));
    await state().setOrderStatus("o-1", "enviado", { carrier: "DHL", tracking: "123" });

    expect(onlyRpc("set_order_status").args).toEqual({ p_order: "o-1", p_status: "enviado", p_shipping: { carrier: "DHL", tracking: "123" } });
    expect(state().orders[0]).toMatchObject({ status: "enviado", shippingInfo: { carrier: "DHL", tracking: "123" } });
    // un cambio normal no recarga existencias
    expect(tableCalls("stock")).toHaveLength(0);
  });

  it("setOrderStatus sin datos de envío manda p_shipping null", async () => {
    fake.on("rpc.set_order_status", () => ok(orderRow({ status: "entregado" })));
    await state().setOrderStatus("o-1", "entregado");
    expect(onlyRpc("set_order_status").args).toEqual({ p_order: "o-1", p_status: "entregado", p_shipping: null });
  });

  it("cancelar un pedido recarga existencias y kardex", async () => {
    fake.on("rpc.set_order_status", () => ok(orderRow({ status: "cancelado" })));
    fake.tables.stock = [{ variant_key: "p-1|Rojo|S", branch: "br-1", qty: 6 }];
    await state().setOrderStatus("o-1", "cancelado");

    expect(state().orders[0].status).toBe("cancelado");
    expect(state().stock).toEqual({ "p-1|Rojo|S": { "br-1": 6 } });
    expect(tableCalls("movements")).toHaveLength(1);
  });

  it("setOrderStatus propaga 'El pedido ya está cancelado'", async () => {
    fake.on("rpc.set_order_status", () => fail("El pedido ya está cancelado"));
    await expect(state().setOrderStatus("o-1", "pagado")).rejects.toThrow("El pedido ya está cancelado");
  });
});

describe("inventario", () => {
  beforeEach(() => {
    signIn();
    fake.tables.stock = [{ variant_key: "p-1|Rojo|S", branch: "br-1", qty: 7 }];
  });

  it("moveStock llama move_stock con p_entries, p_branch, p_type, p_ref y p_note", async () => {
    fake.on("rpc.move_stock", () => ok(null));
    const entries = [{ variantKey: "p-1|Rojo|S", qty: 5 }];
    await state().moveStock(entries, "br-1", "entrada", { ref: "FAC-1", note: "Compra" });

    expect(onlyRpc("move_stock").args).toEqual({ p_entries: entries, p_branch: "br-1", p_type: "entrada", p_ref: "FAC-1", p_note: "Compra" });
    expect(state().stock).toEqual({ "p-1|Rojo|S": { "br-1": 7 } });
    expect(tableCalls("movements")).toHaveLength(1);
  });

  it("moveStock sin metadatos manda p_ref y p_note null", async () => {
    fake.on("rpc.move_stock", () => ok(null));
    await state().moveStock([{ variantKey: "p-1|Rojo|S", qty: -1 }], "br-1", "ajuste");
    expect(onlyRpc("move_stock").args).toEqual({ p_entries: [{ variantKey: "p-1|Rojo|S", qty: -1 }], p_branch: "br-1", p_type: "ajuste", p_ref: null, p_note: null });
  });

  it("moveStock propaga el error y no recarga", async () => {
    fake.on("rpc.move_stock", () => fail("Solo el dueño o el encargado mueven inventario"));
    await expect(state().moveStock([], "br-1", "entrada")).rejects.toThrow("Solo el dueño o el encargado mueven inventario");
    expect(tableCalls("stock")).toHaveLength(0);
  });

  it("transferStock llama transfer_stock con p_entries, p_from y p_to", async () => {
    fake.on("rpc.transfer_stock", () => ok(null));
    const entries = [{ variantKey: "p-1|Rojo|S", qty: 2 }];
    await state().transferStock(entries, "br-1", "br-2");

    expect(onlyRpc("transfer_stock").args).toEqual({ p_entries: entries, p_from: "br-1", p_to: "br-2" });
    expect(tableCalls("stock")).toHaveLength(1);
    expect(tableCalls("movements")).toHaveLength(1);
  });

  it("transferStock propaga el error del traspaso", async () => {
    fake.on("rpc.transfer_stock", () => fail("Sin existencia suficiente para traspasar p-1|Rojo|S"));
    await expect(state().transferStock([{ variantKey: "p-1|Rojo|S", qty: 99 }], "br-1", "br-2")).rejects.toThrow("Sin existencia suficiente para traspasar");
    expect(tableCalls("stock")).toHaveLength(0);
  });
});

describe("cotizaciones", () => {
  const quote: Omit<Quote, "id" | "folio"> = {
    date: "2026-03-02T10:00:00Z",
    validUntil: "2026-03-09T10:00:00Z",
    customerId: "c-1",
    customerName: "Lupita",
    items: [ITEM],
    tierId: "mayor",
    subtotalList: 1000,
    discount: 200,
    subtotal: 800,
    shipping: 250,
    total: 1050,
    depositPct: 0.5,
    status: "borrador",
  };

  beforeEach(() => {
    signIn();
  });

  it("saveQuote llama save_quote con p y agrega la cotización al estado", async () => {
    fake.on("rpc.save_quote", () => ok(quoteRow()));
    const saved = await state().saveQuote(quote);

    expect(onlyRpc("save_quote").args).toEqual({ p: quote });
    expect(saved).toMatchObject({ id: "q-1", folio: "COT-0001", total: 1050 });
    expect(state().quotes).toHaveLength(1);
  });

  it("saveQuote con id edita la cotización existente sin duplicarla", async () => {
    fake.on("rpc.save_quote", () => ok(quoteRow()));
    await state().saveQuote(quote);
    fake.on("rpc.save_quote", () => ok(quoteRow({ status: "enviada", total: "900" })));
    await state().saveQuote({ ...quote, id: "q-1", status: "enviada" });

    expect((rpcCalls("save_quote")[1].args as { p: Row }).p.id).toBe("q-1");
    expect(state().quotes).toHaveLength(1);
    expect(state().quotes[0]).toMatchObject({ status: "enviada", total: 900 });
  });

  it("saveQuote propaga 'Cliente inválido'", async () => {
    fake.on("rpc.save_quote", () => fail("Cliente inválido"));
    await expect(state().saveQuote(quote)).rejects.toThrow("Cliente inválido");
    expect(state().quotes).toEqual([]);
  });

  it("setQuoteStatus llama set_quote_status con p_id y p_status, sin tocar la tabla quotes", async () => {
    fake.tables.quotes = [quoteRow()];
    await state().reload(["quotes"]);
    fake.on("rpc.set_quote_status", () => ok(quoteRow({ status: "aceptada" })));

    await state().setQuoteStatus("q-1", "aceptada");

    expect(onlyRpc("set_quote_status").args).toEqual({ p_id: "q-1", p_status: "aceptada" });
    expect(tableCalls("quotes", "update")).toHaveLength(0);
    expect(state().quotes).toHaveLength(1);
    expect(state().quotes[0].status).toBe("aceptada");
  });

  it("setQuoteStatus propaga el error de la RPC", async () => {
    fake.on("rpc.set_quote_status", () => fail("Cotización no encontrada"));
    await expect(state().setQuoteStatus("q-1", "aceptada")).rejects.toThrow("Cotización no encontrada");
  });

  it("convertQuote llama convert_quote con p_quote y p_deposit, y recarga cotizaciones y existencias", async () => {
    fake.on("rpc.convert_quote", () => ok(orderRow({ id: "o-5", channel: "mayoreo", quote_id: "q-1", status: "apartado" })));
    fake.tables.quotes = [quoteRow({ status: "convertida", order_id: "o-5" })];
    const deposit = { amount: 525, method: "transferencia" as const };

    const order = await state().convertQuote("q-1", deposit);

    expect(onlyRpc("convert_quote").args).toEqual({ p_quote: "q-1", p_deposit: deposit });
    expect(order).toMatchObject({ id: "o-5", channel: "mayoreo", quoteId: "q-1" });
    expect(state().orders.map((o) => o.id)).toEqual(["o-5"]);
    expect(state().quotes[0]).toMatchObject({ status: "convertida", orderId: "o-5" });
    expect(new Set(fake.calls.filter((c) => c.kind === "table").map((c) => c.name))).toEqual(new Set(["quotes", "product_costs", "stock", "movements"]));
  });

  it("convertQuote propaga 'Configura qué sucursal surte el mayoreo'", async () => {
    fake.on("rpc.convert_quote", () => fail("Configura qué sucursal surte el mayoreo"));
    await expect(state().convertQuote("q-1", { amount: 0, method: "efectivo" })).rejects.toThrow("Configura qué sucursal surte el mayoreo");
    expect(state().orders).toEqual([]);
  });
});

describe("negocio y equipo", () => {
  beforeEach(() => {
    signIn();
    useErp.setState({ business: { id: BUSINESS_ID, name: "Boutique Aurora", kind: "boutique", inviteCode: "ABCD2345", orderPrefix: "V-", quotePrefix: "COT-" } });
  });

  it("saveBusiness llama update_business con p_name, p_order_prefix y p_quote_prefix", async () => {
    fake.on("rpc.update_business", () => ok(businessRow({ name: "Nueva Boutique", order_prefix: "P-", quote_prefix: "C-" })));
    await state().saveBusiness({ name: "Nueva Boutique", orderPrefix: "P-", quotePrefix: "C-" });

    expect(onlyRpc("update_business").args).toEqual({ p_name: "Nueva Boutique", p_order_prefix: "P-", p_quote_prefix: "C-" });
    expect(state().business).toEqual({ id: BUSINESS_ID, name: "Nueva Boutique", kind: "boutique", inviteCode: "ABCD2345", orderPrefix: "P-", quotePrefix: "C-" });
  });

  it("saveBusiness propaga el error y conserva el negocio", async () => {
    fake.on("rpc.update_business", () => fail("Los prefijos de folio no pueden estar vacíos"));
    await expect(state().saveBusiness({ name: "X", orderPrefix: "", quotePrefix: "C-" })).rejects.toThrow("Los prefijos de folio no pueden estar vacíos");
    expect(state().business?.name).toBe("Boutique Aurora");
  });

  it("regenerateInviteCode llama regenerate_invite_code sin parámetros y actualiza el código", async () => {
    fake.on("rpc.regenerate_invite_code", () => ok("ZXCV6789"));
    const code = await state().regenerateInviteCode();

    expect(code).toBe("ZXCV6789");
    expect(onlyRpc("regenerate_invite_code").args).toBeUndefined();
    expect(state().business?.inviteCode).toBe("ZXCV6789");
    expect(state().business?.name).toBe("Boutique Aurora");
  });

  it("regenerateInviteCode con el negocio aún sin cargar no inventa uno", async () => {
    useErp.setState({ business: null });
    fake.on("rpc.regenerate_invite_code", () => ok("ZXCV6789"));
    await state().regenerateInviteCode();
    expect(state().business).toBeNull();
  });

  it("regenerateInviteCode propaga el error y conserva el código", async () => {
    fake.on("rpc.regenerate_invite_code", () => fail("Solo el dueño puede cambiar el código de invitación"));
    await expect(state().regenerateInviteCode()).rejects.toThrow("Solo el dueño puede cambiar");
    expect(state().business?.inviteCode).toBe("ABCD2345");
  });

  it("loadTeam lee las membresías con sus perfiles, ordenadas por antigüedad", async () => {
    fake.tables.business_members = [
      memberRow({ profiles: { name: "Ana Dueña", email: "ana@boutique.mx" } }),
      memberRow({ user_id: "u-2", role: "vendedor", branch: "br-2", profiles: { name: "Beto", email: null } }),
    ];
    await state().loadTeam();
    const [call] = tableCalls("business_members");
    expect(opArgs(call, "order")).toEqual(["created_at", { ascending: true }]);
    expect(state().team.map((m) => [m.id, m.name, m.role, m.branch])).toEqual([
      ["u-1", "Ana Dueña", "dueno", null],
      ["u-2", "Beto", "vendedor", "br-2"],
    ]);
  });

  it("setMember llama set_member con p_id, p_role y p_branch y reemplaza solo a ese integrante", async () => {
    useErp.setState({
      team: [
        { ...PROFILE, id: "u-2", name: "Beto", role: "pendiente" },
        { ...PROFILE, id: "u-3", name: "Caro", role: "pendiente" },
      ],
    });
    fake.on("rpc.set_member", () => ok(memberRow({ user_id: "u-2", role: "vendedor", branch: "br-2" })));

    await state().setMember("u-2", "vendedor", "br-2");

    expect(onlyRpc("set_member").args).toEqual({ p_id: "u-2", p_role: "vendedor", p_branch: "br-2" });
    expect(state().team.map((m) => [m.id, m.role, m.branch])).toEqual([
      ["u-2", "vendedor", "br-2"],
      ["u-3", "pendiente", null],
    ]);
  });

  it("setMember permite sucursal null", async () => {
    useErp.setState({ team: [{ ...PROFILE, id: "u-2", role: "vendedor", branch: "br-2" }] });
    fake.on("rpc.set_member", () => ok(memberRow({ user_id: "u-2", role: "vendedor", branch: null })));

    await state().setMember("u-2", "vendedor", null);

    expect(onlyRpc("set_member").args).toEqual({ p_id: "u-2", p_role: "vendedor", p_branch: null });
    expect(state().team[0].branch).toBeNull();
  });

  it("setMember propaga el error", async () => {
    fake.on("rpc.set_member", () => fail("Sucursal inválida"));
    await expect(state().setMember("u-2", "vendedor", "otra")).rejects.toThrow("Sucursal inválida");
  });
});

/* ------------------------------------------------------------------ */
/* Inserts directos: la app no manda business_id                        */
/* ------------------------------------------------------------------ */
describe("altas y ediciones por tabla", () => {
  const productInput: Omit<Product, "id" | "createdAt"> = {
    sku: "VES-01",
    name: "Vestido lino",
    brand: "Aurora",
    category: "Vestidos",
    cost: 120.5,
    price: 349,
    sizes: ["S", "M"],
    colors: [{ name: "Rojo", hex: "#ff0000" }] as unknown as Product["colors"],
    minStock: 2,
    active: true,
  };

  beforeEach(() => {
    signIn();
  });

  it("addProduct inserta las columnas en snake_case sin business_id, id, createdAt ni cost", async () => {
    fake.on("products.insert", () => ok(productRow({ id: "p-7", woo_id: 321 })));
    fake.on("product_costs.upsert", () => ok(null));
    const product = await state().addProduct({ ...productInput, wooId: 321 });

    const [call] = tableCalls("products", "insert");
    expect(opArgs(call, "insert")).toEqual([
      {
        sku: "VES-01",
        name: "Vestido lino",
        brand: "Aurora",
        category: "Vestidos",
        price: 349,
        sizes: ["S", "M"],
        colors: [{ name: "Rojo", hex: "#ff0000" }],
        min_stock: 2,
        active: true,
        woo_id: 321,
      },
    ]);
    expect(opArgs(call, "insert")?.[0]).not.toHaveProperty("business_id");
    expect(methods(call)).toEqual(["insert", "select", "single"]);
    expect(product).toMatchObject({ id: "p-7", wooId: 321, cost: 120.5 });
    const [costCall] = tableCalls("product_costs", "upsert");
    expect(opArgs(costCall, "upsert")).toEqual([{ product_id: "p-7", cost: 120.5 }, { onConflict: "product_id" }]);
    expect(state().products.map((p) => p.id)).toEqual(["p-7"]);
  });

  it("addProduct recarga las existencias (el trigger crea las filas de stock)", async () => {
    fake.on("products.insert", () => ok(productRow()));
    fake.on("product_costs.upsert", () => ok(null));
    fake.tables.stock = [{ variant_key: "p-1|Rojo|S", branch: "br-1", qty: 0 }];
    await state().addProduct(productInput);
    expect(state().stock).toEqual({ "p-1|Rojo|S": { "br-1": 0 } });
  });

  it("addProduct sin wooId no manda woo_id y propaga el error sin tocar el estado", async () => {
    fake.on("products.insert", () => fail('duplicate key value violates unique constraint "products_business_id_sku_key"'));
    await expect(state().addProduct(productInput)).rejects.toThrow("duplicate key");
    expect(opArgs(tableCalls("products", "insert")[0], "insert")?.[0]).not.toHaveProperty("woo_id");
    expect(state().products).toEqual([]);
    expect(tableCalls("stock")).toHaveLength(0);
  });

  it("updateProduct solo manda las columnas del parche (incluido 0 y false)", async () => {
    fake.on("products.update", () => ok(productRow({ price: "0", active: false, min_stock: 5 })));
    await state().updateProduct("p-1", { price: 0, active: false, minStock: 5 });

    const [call] = tableCalls("products", "update");
    expect(opArgs(call, "update")).toEqual([{ price: 0, active: false, min_stock: 5 }]);
    expect(opArgs(call, "eq")).toEqual(["id", "p-1"]);
    expect(state().products[0]).toMatchObject({ price: 0, active: false, minStock: 5 });
  });

  it("updateProduct con cost lo manda a product_costs y no a products", async () => {
    fake.on("products.update", () => ok(productRow({ price: "400" })));
    fake.on("product_costs.upsert", () => ok(null));
    useErp.setState({ products: [{ ...productInput, id: "p-1", createdAt: "2026-02-01T00:00:00Z" }] });
    await state().updateProduct("p-1", { price: 400, cost: 99 });

    expect(opArgs(tableCalls("products", "update")[0], "update")).toEqual([{ price: 400 }]);
    expect(opArgs(tableCalls("product_costs", "upsert")[0], "upsert")).toEqual([{ product_id: "p-1", cost: 99 }, { onConflict: "product_id" }]);
    expect(state().products[0]).toMatchObject({ price: 400, cost: 99 });
  });

  it("updateProduct sin cost no toca product_costs y conserva el costo del estado", async () => {
    fake.on("products.update", () => ok(productRow({ price: "400" })));
    useErp.setState({ products: [{ ...productInput, id: "p-1", createdAt: "2026-02-01T00:00:00Z" }] });
    await state().updateProduct("p-1", { price: 400 });

    expect(tableCalls("product_costs")).toHaveLength(0);
    expect(state().products[0].cost).toBe(120.5);
  });

  it("addCustomer inserta solo los datos del cliente, sin business_id, id ni since", async () => {
    fake.on("customers.insert", () => ok(customerRow({ id: "c-8", business: "Aurora", instagram: "@lupita" })));
    const customer = await state().addCustomer({ name: "Lupita", business: "Aurora", phone: "5551234567", city: "CDMX", state: "CDMX", type: "mayorista", instagram: "@lupita" });

    const [call] = tableCalls("customers", "insert");
    expect(opArgs(call, "insert")).toEqual([{ name: "Lupita", business: "Aurora", phone: "5551234567", city: "CDMX", state: "CDMX", type: "mayorista", instagram: "@lupita" }]);
    expect(opArgs(call, "insert")?.[0]).not.toHaveProperty("business_id");
    expect(customer).toMatchObject({ id: "c-8", business: "Aurora", instagram: "@lupita" });
    expect(state().customers).toHaveLength(1);
  });

  it("addCustomer propaga el error", async () => {
    fake.on("customers.insert", () => fail('new row violates row-level security policy for table "customers"'));
    await expect(state().addCustomer({ name: "X", phone: "1", city: "", state: "", type: "menudeo" })).rejects.toThrow("row-level security");
    expect(state().customers).toEqual([]);
  });

  it("updateCustomer manda solo los campos del parche", async () => {
    fake.on("customers.update", () => ok(customerRow({ phone: "5559999999" })));
    await state().updateCustomer("c-1", { phone: "5559999999" });
    const [call] = tableCalls("customers", "update");
    expect(opArgs(call, "update")).toEqual([{ phone: "5559999999" }]);
    expect(opArgs(call, "eq")).toEqual(["id", "c-1"]);
    expect(state().customers[0].phone).toBe("5559999999");
  });

  it("addExpense inserta el gasto sin business_id y lo pone al inicio de la lista", async () => {
    useErp.setState({ expenses: [{ id: "e-0", date: "2026-02-01T00:00:00Z", category: "otros", description: "Previo", amount: 1, method: "efectivo" }] });
    fake.on("expenses.insert", () => ok(expenseRow({ id: "e-2", branch: "br-1" })));
    await state().addExpense({ date: "2026-03-05T00:00:00Z", category: "renta", description: "Renta marzo", amount: 8000, branch: "br-1", method: "transferencia" });

    const [call] = tableCalls("expenses", "insert");
    expect(opArgs(call, "insert")).toEqual([{ date: "2026-03-05T00:00:00Z", category: "renta", description: "Renta marzo", amount: 8000, branch: "br-1", method: "transferencia" }]);
    expect(opArgs(call, "insert")?.[0]).not.toHaveProperty("business_id");
    expect(state().expenses.map((e) => e.id)).toEqual(["e-2", "e-0"]);
  });

  it("addExpense sin sucursal manda branch null", async () => {
    fake.on("expenses.insert", () => ok(expenseRow()));
    await state().addExpense({ date: "2026-03-05T00:00:00Z", category: "renta", description: "Renta", amount: 100, method: "efectivo" });
    expect((opArgs(tableCalls("expenses", "insert")[0], "insert")?.[0] as Row).branch).toBeNull();
    expect(state().expenses[0].branch).toBeUndefined();
  });

  it("addExpense propaga el error", async () => {
    fake.on("expenses.insert", () => fail('new row for relation "expenses" violates check constraint "expenses_amount_check"'));
    await expect(state().addExpense({ date: "2026-03-05T00:00:00Z", category: "renta", description: "Renta", amount: 0, method: "efectivo" })).rejects.toThrow("expenses_amount_check");
    expect(state().expenses).toEqual([]);
  });

  it("removeExpense borra por id y lo quita de la lista", async () => {
    useErp.setState({
      expenses: [
        { id: "e-1", date: "2026-03-05T00:00:00Z", category: "renta", description: "A", amount: 1, method: "efectivo" },
        { id: "e-2", date: "2026-03-06T00:00:00Z", category: "renta", description: "B", amount: 2, method: "efectivo" },
      ],
    });
    fake.on("expenses.delete", () => ok(null));
    await state().removeExpense("e-1");

    expect(opArgs(tableCalls("expenses", "delete")[0], "eq")).toEqual(["id", "e-1"]);
    expect(state().expenses.map((e) => e.id)).toEqual(["e-2"]);
  });

  it("removeExpense propaga el error y no quita el gasto", async () => {
    useErp.setState({ expenses: [{ id: "e-1", date: "2026-03-05T00:00:00Z", category: "renta", description: "A", amount: 1, method: "efectivo" }] });
    fake.on("expenses.delete", () => fail("permission denied"));
    await expect(state().removeExpense("e-1")).rejects.toThrow("permission denied");
    expect(state().expenses).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Configuración (settings)                                             */
/* ------------------------------------------------------------------ */
describe("guardado de configuración", () => {
  beforeEach(() => {
    signIn();
    fake.on("settings.upsert", () => ok({}));
  });

  const expectUpsert = (key: string, value: unknown) => {
    const calls = tableCalls("settings", "upsert");
    expect(calls).toHaveLength(1);
    const [row, options] = opArgs(calls[0], "upsert") as [Row, Row];
    expect(row).toEqual({ business_id: BUSINESS_ID, key, value, updated_at: expect.any(String) });
    expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false);
    expect(options).toEqual({ onConflict: "business_id,key" });
    expect(methods(calls[0])).toEqual(["upsert", "select", "single"]);
  };

  it("saveProfileSettings guarda la llave profile con el JSON camelCase y actualiza el estado", async () => {
    const next: BusinessProfile = { ...DEFAULT_PROFILE, legalName: "Aurora SA", ticketFooter: "Vuelve pronto", accentColor: "#aa5500" };
    await state().saveProfileSettings(next);

    expectUpsert("profile", next);
    expect(state().profileSettings).toBe(next);
  });

  it("saveCatalog guarda la llave catalog, actualiza el estado y la configuración vigente", async () => {
    const next: CatalogSettings = { categories: ["Vestidos"], sizePresets: [{ name: "Unitalla", sizes: ["Única"] }], sizeCurve: { S: 1 } };
    await state().saveCatalog(next);

    expectUpsert("catalog", next);
    expect(state().catalog).toBe(next);
    expect(currentCatalog()).toBe(next);
  });

  it("saveSales guarda la llave sales, actualiza el estado y las comisiones vigentes", async () => {
    const next: SalesSettings = { channels: ["tienda"], carriers: ["DHL"], paymentFees: { ...DEFAULT_SALES.paymentFees, tarjeta: 0.04 } };
    await state().saveSales(next);

    expectUpsert("sales", next);
    expect(state().sales).toBe(next);
    expect(currentSales()).toBe(next);
    expect(paymentFee("tarjeta")).toBe(0.04);
  });

  it("saveWholesale guarda la llave wholesale y activa el módulo de mayoreo", async () => {
    const next: WholesaleSettings = {
      ...DEFAULT_WHOLESALE,
      enabled: true,
      tiers: [
        { id: "mayor", name: "Mayoreo", minPieces: 6, discount: 0.2, description: "6+" },
        { id: "lista", name: "Lista", minPieces: 1, discount: 0, description: "Lista" },
      ],
      distributorCustomerMin: 30,
      depositPct: 0.4,
      freeShippingFrom: 3000,
      flatShipping: 200,
    };
    await state().saveWholesale(next);

    expectUpsert("wholesale", next);
    expect(isWholesaleEnabled()).toBe(true);
    expect(TIERS.map((t) => t.id)).toEqual(["lista", "mayor"]);
    expect(state().wholesale.enabled).toBe(true);
    expect(state().wholesale.tiers.map((t) => t.id)).toEqual(["lista", "mayor"]);
    expect(state().wholesale.distributorCustomerMin).toBe(30);
    expect(state().wholesale).toEqual(wholesaleSnapshot());
  });

  it("desactivar mayoreo vuelve a los niveles por defecto", async () => {
    await state().saveWholesale({ ...DEFAULT_WHOLESALE, enabled: true });
    await state().saveWholesale({ ...DEFAULT_WHOLESALE, enabled: false });
    expect(isWholesaleEnabled()).toBe(false);
    expect(state().wholesale.enabled).toBe(false);
  });

  it("si el upsert falla no cambia ni el estado ni la configuración vigente", async () => {
    fake.on("settings.upsert", () => fail('new row violates row-level security policy for table "settings"'));
    const catalogBefore = state().catalog;

    await expect(state().saveCatalog({ categories: ["X"], sizePresets: [], sizeCurve: {} })).rejects.toThrow("row-level security");
    await expect(state().saveSales({ ...DEFAULT_SALES, channels: ["web"] })).rejects.toThrow("row-level security");
    await expect(state().saveWholesale({ ...DEFAULT_WHOLESALE, enabled: true })).rejects.toThrow("row-level security");
    await expect(state().saveProfileSettings({ ...DEFAULT_PROFILE, legalName: "X" })).rejects.toThrow("row-level security");

    expect(state().catalog).toBe(catalogBefore);
    expect(currentCatalog().categories).toEqual(DEFAULT_CATALOG.categories);
    expect(currentSales().channels).toEqual(DEFAULT_SALES.channels);
    expect(isWholesaleEnabled()).toBe(false);
    expect(state().wholesale.enabled).toBe(false);
    expect(state().profileSettings.legalName).toBe("");
  });

  it("sin sesión no guarda nada", async () => {
    useErp.setState({ profile: null });
    await expect(state().saveCatalog({ categories: ["X"], sizePresets: [], sizeCurve: {} })).rejects.toThrow("No hay una sesión activa");
    expect(tableCalls("settings", "upsert")).toHaveLength(0);
    expect(currentCatalog().categories).toEqual(DEFAULT_CATALOG.categories);
  });
});

/* ------------------------------------------------------------------ */
/* Sucursales                                                           */
/* ------------------------------------------------------------------ */
describe("saveBranch", () => {
  const newBranch = { name: "Sucursal Sur", short: "Sur", address: "Av. 5", pos: true, isWarehouse: false, active: true };

  beforeEach(() => {
    signIn();
    useErp.setState({ branches: [branch({ id: "br-1", sort: 0, isWarehouse: true }), branch({ id: "br-2", short: "Norte", sort: 5 })] });
    fake.tables.branches = [branchRow(), branchRow({ id: "br-2", short: "Norte", is_warehouse: false, sort: 5 }), branchRow({ id: "br-9", short: "Sur", is_warehouse: false, sort: 6 })];
    fake.on("branches.insert", () => ok(branchRow({ id: "br-9", name: "Sucursal Sur", short: "Sur", address: "Av. 5", is_warehouse: false, sort: 6 })));
  });

  it("crea una sucursal sin business_id ni id, con sort = máximo + 1", async () => {
    const saved = await state().saveBranch(newBranch);

    const [call] = tableCalls("branches", "insert");
    expect(opArgs(call, "insert")).toEqual([{ name: "Sucursal Sur", short: "Sur", address: "Av. 5", pos: true, is_warehouse: false, active: true, sort: 6 }]);
    expect(opArgs(call, "insert")?.[0]).not.toHaveProperty("business_id");
    expect(opArgs(call, "insert")?.[0]).not.toHaveProperty("id");
    expect(methods(call)).toEqual(["insert", "select", "single"]);
    expect(saved).toEqual(branch({ id: "br-9", name: "Sucursal Sur", short: "Sur", address: "Av. 5", sort: 6 }));
  });

  it("sin sucursales previas la primera lleva sort 0 y respeta un sort explícito", async () => {
    useErp.setState({ branches: [] });
    await state().saveBranch(newBranch);
    expect((opArgs(tableCalls("branches", "insert")[0], "insert")?.[0] as Row).sort).toBe(0);

    fake.calls.length = 0;
    await state().saveBranch({ ...newBranch, sort: 3 });
    expect((opArgs(tableCalls("branches", "insert")[0], "insert")?.[0] as Row).sort).toBe(3);
  });

  it("recarga sucursales y existencias, y aplica las sucursales vigentes", async () => {
    await state().saveBranch(newBranch);
    expect(state().branches.map((b) => b.id)).toEqual(["br-1", "br-2", "br-9"]);
    expect(currentBranches()).toBe(state().branches);
    expect(tableCalls("stock")).toHaveLength(1);
  });

  it("una sucursal que no surte no toca a la bodega actual", async () => {
    await state().saveBranch(newBranch);
    expect(tableCalls("branches", "update")).toHaveLength(0);
  });

  it("marcar una sucursal nueva como bodega desmarca antes la anterior", async () => {
    fake.on("branches.update", () => ok([{ id: "br-1" }]));
    fake.on("branches.insert", () => ok(branchRow({ id: "br-9", is_warehouse: true, sort: 6 })));
    const saved = await state().saveBranch({ ...newBranch, isWarehouse: true });

    const [release] = tableCalls("branches", "update");
    expect(opArgs(release, "update")).toEqual([{ is_warehouse: false }]);
    expect(opArgs(release, "eq")).toEqual(["is_warehouse", true]);
    expect(opArgs(release, "select")).toEqual(["id"]);
    expect(methods(release)).not.toContain("neq");
    // el orden importa: el índice único parcial no admite dos bodegas a la vez
    const order = fake.calls.filter((c) => c.name === "branches" && ["update", "insert"].includes(fake.verbOf(c))).map((c) => fake.verbOf(c));
    expect(order).toEqual(["update", "insert"]);
    expect(saved.isWarehouse).toBe(true);
  });

  it("al editar una sucursal como bodega excluye a la propia sucursal al desmarcar", async () => {
    fake.on("branches.update", (call) => (methods(call).includes("single") ? ok(branchRow({ id: "br-2", short: "Norte", is_warehouse: true, sort: 5 })) : ok([{ id: "br-1" }])));
    await state().saveBranch({ id: "br-2", name: "Sucursal Norte", short: "Norte", address: "Calle 2", pos: true, isWarehouse: true, active: true });

    const [release, edit] = tableCalls("branches", "update");
    expect(opArgs(release, "update")).toEqual([{ is_warehouse: false }]);
    expect(opArgs(release, "eq")).toEqual(["is_warehouse", true]);
    expect(opArgs(release, "neq")).toEqual(["id", "br-2"]);
    expect(opArgs(edit, "update")).toEqual([{ name: "Sucursal Norte", short: "Norte", address: "Calle 2", pos: true, is_warehouse: true, active: true }]);
    expect(opArgs(edit, "eq")).toEqual(["id", "br-2"]);
  });

  it("si el guardado falla restaura la bodega anterior y propaga el error", async () => {
    fake.on("branches.update", () => ok([{ id: "br-1" }]));
    fake.on("branches.insert", () => fail('new row violates row-level security policy for table "branches"'));

    await expect(state().saveBranch({ ...newBranch, isWarehouse: true })).rejects.toThrow("row-level security");

    const updates = tableCalls("branches", "update");
    expect(updates).toHaveLength(2);
    expect(opArgs(updates[1], "update")).toEqual([{ is_warehouse: true }]);
    expect(opArgs(updates[1], "in")).toEqual(["id", ["br-1"]]);
  });

  it("si falla la edición de una sucursal también restaura la bodega anterior", async () => {
    fake.on("branches.update", (call) => (methods(call).includes("single") ? fail("fallo al guardar") : ok([{ id: "br-1" }])));

    await expect(state().saveBranch({ id: "br-2", name: "Norte", short: "Norte", address: "", pos: true, isWarehouse: true, active: true })).rejects.toThrow("fallo al guardar");

    const updates = tableCalls("branches", "update");
    expect(updates).toHaveLength(3);
    expect(opArgs(updates[2], "update")).toEqual([{ is_warehouse: true }]);
    expect(opArgs(updates[2], "in")).toEqual(["id", ["br-1"]]);
  });

  it("si falla la recarga después de guardar no restaura la bodega anterior", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.on("branches.update", () => ok([{ id: "br-1" }]));
    fake.on("branches.select", () => fail("sin red"));

    const saved = await state().saveBranch({ ...newBranch, isWarehouse: true });

    expect(saved.id).toBe("br-9");
    expect(tableCalls("branches", "update")).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  it("si no había bodega anterior que restaurar, un fallo no hace updates extra", async () => {
    fake.on("branches.update", () => ok([]));
    fake.on("branches.insert", () => fail("fallo"));
    await expect(state().saveBranch({ ...newBranch, isWarehouse: true })).rejects.toThrow("fallo");
    expect(tableCalls("branches", "update")).toHaveLength(1);
  });

  it("si falla el desmarcado de la bodega anterior no intenta guardar", async () => {
    fake.on("branches.update", () => fail("permission denied"));
    await expect(state().saveBranch({ ...newBranch, isWarehouse: true })).rejects.toThrow("permission denied");
    expect(tableCalls("branches", "insert")).toHaveLength(0);
    expect(tableCalls("branches", "update")).toHaveLength(1);
  });

  it("archivar una sucursal manda active false, no borra y no cambia sort si no se indica", async () => {
    fake.on("branches.update", () => ok(branchRow({ id: "br-2", short: "Norte", is_warehouse: false, active: false, sort: 5 })));
    fake.tables.branches = [branchRow(), branchRow({ id: "br-2", short: "Norte", is_warehouse: false, active: false, sort: 5 })];
    const saved = await state().saveBranch({ id: "br-2", name: "Sucursal Norte", short: "Norte", address: "", pos: true, isWarehouse: false, active: false });

    const [call] = tableCalls("branches", "update");
    expect(opArgs(call, "update")).toEqual([{ name: "Sucursal Norte", short: "Norte", address: "", pos: true, is_warehouse: false, active: false }]);
    expect(opArgs(call, "eq")).toEqual(["id", "br-2"]);
    expect(saved.active).toBe(false);
    expect(tableCalls("branches", "delete")).toHaveLength(0);
    // sigue en la lista (las sucursales no se borran)
    expect(state().branches.map((b) => b.id)).toEqual(["br-1", "br-2"]);
  });

  it("editar con sort explícito lo incluye en el update", async () => {
    fake.on("branches.update", () => ok(branchRow({ id: "br-2", sort: 2 })));
    await state().saveBranch({ id: "br-2", name: "N", short: "N", address: "", pos: true, isWarehouse: false, active: true, sort: 2 });
    expect((opArgs(tableCalls("branches", "update")[0], "update")?.[0] as Row).sort).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Logo                                                                 */
/* ------------------------------------------------------------------ */
describe("logo", () => {
  const png = () => new File(["x"], "Mi Logo.PNG", { type: "image/png" });
  const LOGOS = `${fake.PUBLIC_BASE}/logos`;

  beforeEach(() => {
    signIn();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    fake.on("settings.upsert", () => ok({}));
  });

  it("uploadLogo sube al bucket logos en <business_id>/<archivo> y guarda la URL pública", async () => {
    const file = png();
    const url = await state().uploadLogo(file);

    const path = `${BUSINESS_ID}/logo-1700000000000.png`;
    expect(fake.upload).toHaveBeenCalledWith(path, file, { contentType: "image/png", upsert: false });
    expect(url).toBe(`${LOGOS}/${path}`);
    expect(state().profileSettings.logoUrl).toBe(url);

    const [row] = opArgs(tableCalls("settings", "upsert")[0], "upsert") as [Row];
    expect(row).toMatchObject({ business_id: BUSINESS_ID, key: "profile", value: { ...DEFAULT_PROFILE, logoUrl: url } });
  });

  it("uploadLogo conserva el resto del perfil al guardar la URL", async () => {
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, legalName: "Aurora SA", accentColor: "#112233" } });
    await state().uploadLogo(png());
    expect(state().profileSettings).toMatchObject({ legalName: "Aurora SA", accentColor: "#112233" });
  });

  it("uploadLogo sin logo previo no borra ningún archivo", async () => {
    await state().uploadLogo(png());
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it("uploadLogo borra el archivo del logo anterior", async () => {
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, logoUrl: `${LOGOS}/${BUSINESS_ID}/logo-viejo.png` } });
    await state().uploadLogo(png());
    expect(fake.remove).toHaveBeenCalledWith([`${BUSINESS_ID}/logo-viejo.png`]);
  });

  it("uploadLogo no falla si no se puede borrar el logo anterior", async () => {
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, logoUrl: `${LOGOS}/${BUSINESS_ID}/logo-viejo.png` } });
    fake.remove.mockImplementation(() => Promise.reject(new Error("sin red")));
    const url = await state().uploadLogo(png());
    expect(state().profileSettings.logoUrl).toBe(url);
  });

  it("uploadLogo propaga el error de Storage y no guarda el perfil", async () => {
    fake.upload.mockImplementation(async () => ({ error: { message: "mime type text/plain is not supported" } }));
    await expect(state().uploadLogo(png())).rejects.toThrow("mime type text/plain is not supported");
    expect(tableCalls("settings", "upsert")).toHaveLength(0);
    expect(state().profileSettings.logoUrl).toBeNull();
  });

  it("si no se puede guardar el perfil, borra el archivo recién subido y conserva el logo anterior", async () => {
    const previous = `${LOGOS}/${BUSINESS_ID}/logo-viejo.png`;
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, logoUrl: previous } });
    fake.on("settings.upsert", () => fail("permission denied"));

    await expect(state().uploadLogo(png())).rejects.toThrow("permission denied");
    expect(state().profileSettings.logoUrl).toBe(previous);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.remove).toHaveBeenCalledWith([`${BUSINESS_ID}/logo-1700000000000.png`]);
  });

  it("uploadLogo rechaza tipos que no sean PNG, JPG o WebP sin subir nada", async () => {
    await expect(state().uploadLogo(new File(["x"], "logo.gif", { type: "image/gif" }))).rejects.toThrow("PNG, JPG o WebP");
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("uploadLogo rechaza archivos de más de 2 MB sin subir nada", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" });
    await expect(state().uploadLogo(big)).rejects.toThrow("2 MB");
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("uploadLogo toma la extensión del tipo MIME aunque el nombre no tenga", async () => {
    await state().uploadLogo(new File(["x"], "logo", { type: "image/jpeg" }));
    expect(fake.upload.mock.calls[0][0]).toBe(`${BUSINESS_ID}/logo-1700000000000.jpg`);
  });

  it("uploadLogo sin sesión no sube nada", async () => {
    useErp.setState({ profile: null });
    await expect(state().uploadLogo(png())).rejects.toThrow("No hay una sesión activa");
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("removeLogo deja logoUrl en null y borra el archivo", async () => {
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, legalName: "Aurora SA", logoUrl: `${LOGOS}/${BUSINESS_ID}/logo-1.png` } });
    await state().removeLogo();

    expect(state().profileSettings).toEqual({ ...DEFAULT_PROFILE, legalName: "Aurora SA", logoUrl: null });
    const [row] = opArgs(tableCalls("settings", "upsert")[0], "upsert") as [Row];
    expect(row).toMatchObject({ key: "profile", value: { logoUrl: null, legalName: "Aurora SA" } });
    expect(fake.remove).toHaveBeenCalledWith([`${BUSINESS_ID}/logo-1.png`]);
  });

  it("removeLogo decodifica la ruta y descarta el query string de la URL", async () => {
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, logoUrl: `${LOGOS}/${BUSINESS_ID}/mi%20logo.png?v=2` } });
    await state().removeLogo();
    expect(fake.remove).toHaveBeenCalledWith([`${BUSINESS_ID}/mi logo.png`]);
  });

  it("removeLogo sin logo guarda null y no toca Storage", async () => {
    await state().removeLogo();
    expect(state().profileSettings.logoUrl).toBeNull();
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it("removeLogo no borra el archivo si falla el guardado del perfil", async () => {
    const previous = `${LOGOS}/${BUSINESS_ID}/logo-1.png`;
    useErp.setState({ profileSettings: { ...DEFAULT_PROFILE, logoUrl: previous } });
    fake.on("settings.upsert", () => fail("permission denied"));
    await expect(state().removeLogo()).rejects.toThrow("permission denied");
    expect(state().profileSettings.logoUrl).toBe(previous);
    expect(fake.remove).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* errorMessage                                                         */
/* ------------------------------------------------------------------ */
describe("errorMessage", () => {
  it("devuelve el mensaje de un Error", () => {
    expect(errorMessage(new Error("Sin existencia suficiente"))).toBe("Sin existencia suficiente");
  });

  it("usa un mensaje genérico para valores que no son Error", () => {
    expect(errorMessage("texto")).toBe("Algo salió mal, intenta de nuevo");
    expect(errorMessage(null)).toBe("Algo salió mal, intenta de nuevo");
    expect(errorMessage({ message: "objeto plano" })).toBe("Algo salió mal, intenta de nuevo");
  });
});
