import {
  BarChart3,
  Boxes,
  ChefHat,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  Landmark,
  QrCode,
  Settings,
  ShoppingBag,
  Store,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { AppRole, BusinessKind, OwnerBusiness, Role } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Boutique: el personal (vendedor o encargado) lo ve bloqueado. */
  ownerOnly?: boolean;
  wholesaleOnly?: boolean;
  badge?: "orders" | "quotes";
  /** Restaurante: roles que lo ven. */
  roles?: Role[];
}

export interface NavGroup {
  section: string;
  items: NavItem[];
}

const BOUTIQUE_NAV: NavGroup[] = [
  {
    section: "Operación",
    items: [
      { href: "/", label: "Panel general", icon: LayoutDashboard },
      { href: "/pedidos", label: "Pedidos", icon: ShoppingBag, badge: "orders" },
      { href: "/pos", label: "Punto de venta", icon: Store },
      { href: "/inventario", label: "Inventario", icon: Boxes },
      { href: "/mayoreo", label: "Mayoreo", icon: FileText, badge: "quotes", wholesaleOnly: true },
      { href: "/clientes", label: "Clientes", icon: Users },
    ],
  },
  {
    section: "Negocio",
    items: [
      { href: "/finanzas", label: "Finanzas", icon: Wallet, ownerOnly: true },
      { href: "/reportes", label: "Reportes", icon: BarChart3, ownerOnly: true },
      { href: "/equipo", label: "Equipo", icon: UserCog, ownerOnly: true },
      { href: "/configuracion", label: "Configuración", icon: Settings, ownerOnly: true },
    ],
  },
];

const OWNER: Role[] = ["dueno"];
const RESTO_NAV: NavGroup[] = [
  {
    section: "Operación",
    items: [
      { href: "/", label: "Panel general", icon: LayoutDashboard, roles: OWNER },
      { href: "/caja", label: "Caja", icon: Landmark, roles: ["dueno", "cajero"] },
      { href: "/mesas-en-vivo", label: "Mesas en vivo", icon: LayoutGrid, roles: ["dueno", "mesero"] },
      { href: "/cocina", label: "Cocina", icon: ChefHat, roles: ["dueno", "cocina"] },
    ],
  },
  {
    section: "Carta",
    items: [
      { href: "/menu", label: "Menú", icon: UtensilsCrossed, roles: OWNER },
      { href: "/mesas", label: "Mesas y QR", icon: QrCode, roles: OWNER },
    ],
  },
  {
    section: "Negocio",
    items: [
      { href: "/finanzas", label: "Finanzas", icon: Wallet, roles: OWNER },
      { href: "/reportes", label: "Reportes", icon: BarChart3, roles: OWNER },
      { href: "/equipo", label: "Equipo", icon: UserCog, roles: OWNER },
      { href: "/configuracion", label: "Configuración", icon: Settings, roles: OWNER },
    ],
  },
];

/** `/mesas` no debe encender `/mesas-en-vivo`: se compara por segmento. */
export const pathMatches = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** Menú del negocio según su giro y el rol; en restaurante cada rol solo ve lo suyo. */
export function navFor(kind: BusinessKind, role: Role): NavGroup[] {
  if (kind === "boutique") return BOUTIQUE_NAV;
  return RESTO_NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles?.includes(role)) })).filter((g) => g.items.length);
}

/** Pantalla de inicio de un rol dentro de su negocio. */
export const homeFor = (kind: BusinessKind, role: Role) => navFor(kind, role)[0]?.items[0].href ?? "/";

const RESTO_ONLY = ["/caja", "/mesas-en-vivo", "/cocina", "/mesas", "/menu"];

/** Restaurante: solo las rutas de su menú. Boutique conserva las suyas (el bloqueo del personal lo hace el shell). */
export function canOpen(kind: BusinessKind, role: Role, pathname: string) {
  if (kind === "boutique") return !RESTO_ONLY.some((h) => pathMatches(h, pathname));
  return navFor(kind, role).some((g) => g.items.some((i) => pathMatches(i.href, pathname)));
}

/** A dónde va quien acaba de entrar: administrador, dueño (o cuenta sin negocios) o personal. */
export function routeAfterLogin(isAdmin: boolean, businesses: OwnerBusiness[]) {
  if (isAdmin) return "/admin";
  if (businesses.length === 0 || businesses.some((b) => b.role === "dueno")) return "/negocios";
  const b = businesses.find((x) => x.active) ?? businesses[0];
  const role: AppRole = b.role;
  return role === "pendiente" ? "/" : homeFor(b.kind, role);
}
