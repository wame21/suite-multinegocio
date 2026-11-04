"use client";

import {
  AlertTriangle,
  Ban,
  ChevronLeft,
  CreditCard,
  Hourglass,
  Lock,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { BrandLockup, BrandMark } from "@/components/brand";
import { PaymentInfo } from "@/components/payment-info";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { canOpen, homeFor, navFor, pathMatches } from "@/lib/access";
import { KIND_LABEL } from "@/lib/constants";
import { mxn } from "@/lib/format";
import { amountDue, dueLabel, graceNotice, isBlocked, needsPayment, STATE_LABELS } from "@/lib/membership";
import { useBusinessName, useErp, useWholesaleEnabled } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Rutas que se muestran sin el menú lateral ni la carga de datos. */
const BARE_PATHS = ["/login", "/admin"];
/** Cuenta del dueño (/negocios) y menú público del comensal (/m/...) tienen su propio marco. */
const isBare = (pathname: string) =>
  BARE_PATHS.includes(pathname) || pathname === "/negocios" || pathname.startsWith("/negocios/") || pathname.startsWith("/m/");

const ROLE_NAME: Record<string, string> = { vendedor: "Vendedor", encargado: "Encargado", mesero: "Mesero", cajero: "Cajero", cocina: "Cocina" };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex: string): [number, number, number] {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Texto oscuro o claro, el que más contraste dé sobre el color de fondo. */
function onColor(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? "oklch(0.14 0.006 75)" : "oklch(0.98 0 0)";
}

const ACCENT_VARS = ["--gold", "--gold-foreground", "--ring", "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring", "--primary", "--primary-foreground"];

/**
 * Color de acento del negocio sobre el tema dorado. Se escribe en documentElement (gana a :root y .dark):
 * --gold, --ring y --sidebar-primary toman el color; en claro, --gold se oscurece un poco para leerse sobre
 * fondo blanco, y en oscuro --primary (botones) también toma el acento, igual que el tema por defecto.
 * Sin color válido no se escribe nada y queda el tema actual.
 */
function AccentTheme() {
  const accent = useErp((s) => s.profileSettings.accentColor);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
    clear();
    if (!accent || !HEX.test(accent)) return;
    const rgb = parseHex(accent);
    const gold = dark ? toHex(rgb) : toHex(rgb.map((v) => v * 0.55));
    const set = (name: string, value: string) => root.style.setProperty(name, value);
    set("--gold", gold);
    set("--gold-foreground", onColor(dark ? rgb : parseHex(gold)));
    set("--ring", toHex(rgb));
    set("--sidebar-primary", toHex(rgb));
    set("--sidebar-primary-foreground", onColor(rgb));
    set("--sidebar-ring", toHex(rgb));
    set("--primary", toHex(rgb));
    set("--primary-foreground", onColor(rgb));
    return clear;
  }, [accent, dark]);

  return null;
}

function useNavBadges() {
  const orders = useErp((s) => s.orders);
  const quotes = useErp((s) => s.quotes);
  const toAttend = orders.filter((o) => o.status === "pendiente" || o.status === "apartado" || o.status === "pagado").length;
  const openQuotes = quotes.filter((q) => q.status === "enviada" || q.status === "borrador").length;
  return { orders: toAttend, quotes: openQuotes };
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const role = useErp((s) => s.role);
  const kind = useErp((s) => s.kind);
  const wholesale = useWholesaleEnabled();
  const badges = useNavBadges();

  return (
    <nav className="flex flex-col gap-6">
      {navFor(kind, role).map((group) => (
        <div key={group.section} className="flex flex-col gap-1">
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">
            {group.section}
          </div>
          {group.items.filter((item) => wholesale || !item.wholesaleOnly).map((item) => {
            const active = pathMatches(item.href, pathname);
            const locked = item.ownerOnly && role !== "dueno";
            const count = item.badge ? badges[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group flex h-11 items-center gap-3 rounded-[14px] px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-primary/15 font-semibold text-sidebar-accent-foreground inset-ring inset-ring-sidebar-primary/45 hover:bg-sidebar-primary/20",
                  locked && "opacity-50",
                )}
              >
                <item.icon className={cn("size-[18px] shrink-0", active ? "text-gold" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80")} />
                <span className="flex-1 truncate">{item.label}</span>
                {locked ? (
                  <Lock className="size-3.5 text-sidebar-foreground/40" />
                ) : count > 0 ? (
                  <span className="rounded-full bg-sidebar-primary/15 px-1.5 py-px text-[11px] font-medium tabular text-gold">
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Solo para el dueño: vuelve a "Mis negocios" y muestra en qué negocio está. */
function BusinessSelector({ onNavigate }: { onNavigate?: () => void }) {
  const active = useErp((s) => s.active);
  const businessName = useBusinessName();
  if (!active) return null;
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-sidebar-accent/60 p-2 ring-1 ring-sidebar-border">
      <Link href="/negocios" onClick={onNavigate} className="flex h-6 items-center gap-1 px-1 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground">
        <ChevronLeft className="size-3.5" /> Mis negocios
      </Link>
      <div className="flex min-w-0 items-center gap-2 px-1">
        <BrandMark className="size-8 text-xs" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold">{businessName}</div>
          <div className="truncate text-[11px] text-sidebar-foreground/60">
            {KIND_LABEL[active.kind]} · {STATE_LABELS[active.state]}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const live = useErp((s) => s.live);
  const owner = useErp((s) => s.role === "dueno");
  return (
    <div className="flex h-full flex-col gap-8 px-3 py-5 text-sidebar-foreground">
      {owner && <BusinessSelector onNavigate={onNavigate} />}
      <div className="px-2">
        <BrandLockup />
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-sidebar-accent-foreground">
          <span className="relative flex size-2">
            {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-emerald-400" : "bg-amber-400")} />
          </span>
          {live ? "En línea" : "Reconectando…"}
        </div>
        <p className="mt-1 text-sidebar-foreground/55">
          {live ? "Ventas e inventario se actualizan en tiempo real entre sucursales." : "Los cambios de otros usuarios aparecerán al reconectar."}
        </p>
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button variant="ghost" size="icon" aria-label="Cambiar tema" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

/** Acceso al panel /admin, solo para administradores de la plataforma (la página vuelve a validar). */
export function AdminLink() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void supabase()
      .rpc("is_platform_admin")
      .then(({ data }) => setAdmin(data === true));
  }, []);
  if (!admin) return null;
  return (
    <Button asChild variant="outline" size="sm" aria-label="Administración">
      <Link href="/admin">
        <ShieldCheck /> <span className="hidden sm:inline">Administración</span>
      </Link>
    </Button>
  );
}

function UserMenu() {
  const profile = useErp((s) => s.profile);
  const signOut = useErp((s) => s.signOut);
  const branches = useErp((s) => s.branches);
  if (!profile) return null;
  const owner = profile.role === "dueno";
  const branch = branches.find((b) => b.id === profile.branch)?.short;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 gap-2 pl-1.5">
          <span className="grid size-6 place-items-center rounded-full bg-gold text-[11px] font-semibold text-gold-foreground">
            {profile.name.charAt(0).toUpperCase()}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-xs font-medium">{profile.name}</span>
            <span className="block text-[10px] text-muted-foreground">
              {owner ? "Dueño · acceso total" : branch ? `${ROLE_NAME[profile.role]} · ${branch}` : ROLE_NAME[profile.role]}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{profile.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOut /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Restricted() {
  return (
    <div className="mx-auto mt-24 flex max-w-md flex-col items-center gap-4 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-muted">
        <Lock className="size-6 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Sección exclusiva del dueño</h2>
      <p className="text-sm text-muted-foreground">
        Vendedores y encargados no pueden ver costos, utilidades ni gastos del negocio. Cada usuario ve solo lo que necesita para trabajar.
      </p>
    </div>
  );
}

/** Aviso de pago pendiente (gracia o últimos 3 días de prueba): diálogo al cargar la app y banner fijo. */
function MembershipNotice() {
  const m = useErp((s) => s.membership);
  const [open, setOpen] = useState(true);
  if (!m || !needsPayment(m)) return null;

  const text = `${graceNotice(m)} A pagar: ${mxn(amountDue(m))} (${dueLabel(m)}).`;
  return (
    <>
      <div role="status" className="flex items-start gap-2 bg-amber-100 px-4 py-2 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100 md:px-6">
        <AlertTriangle className="mt-px size-3.5 shrink-0" />
        <span>{text}</span>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registra tu pago</DialogTitle>
            <DialogDescription>{text}</DialogDescription>
          </DialogHeader>
          <PaymentInfo />
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Botón a "Mis negocios" para el dueño, en las pantallas que le cierran el negocio activo. */
function OwnerLink() {
  const owner = useErp((s) => s.profile?.role === "dueno");
  if (!owner) return null;
  return (
    <Button asChild variant="outline">
      <Link href="/negocios">Mis negocios</Link>
    </Button>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">{children}</div>
    </div>
  );
}

/** Carga la sesión y los datos del negocio antes de mostrar la app. */
function DataGate({ children }: { children: ReactNode }) {
  const status = useErp((s) => s.status);
  const error = useErp((s) => s.error);
  const profile = useErp((s) => s.profile);
  const init = useErp((s) => s.init);
  const signOut = useErp((s) => s.signOut);
  const membership = useErp((s) => s.membership);
  const active = useErp((s) => s.active);
  const kind = useErp((s) => s.kind);
  const role = useErp((s) => s.role);
  const router = useRouter();
  const pathname = usePathname();
  // Cuenta de dueño sin negocio activo: su lugar es Mis negocios.
  const toOwnerHome = status === "ready" && !!profile && !profile.businessId;
  // Cada rol de restaurante abre solo sus rutas; boutique conserva las suyas.
  const toRoleHome = status === "ready" && !!profile?.businessId && profile.role !== "pendiente" && !canOpen(kind, role, pathname);

  useEffect(() => {
    // switchBusiness y Mis negocios ya dejan el store cargado o reiniciado: solo se carga si falta.
    if (useErp.getState().status !== "ready") void init();
  }, [init]);

  useEffect(() => {
    if (toOwnerHome) router.replace("/negocios");
    else if (toRoleHome) router.replace(homeFor(kind, role));
  }, [toOwnerHome, toRoleHome, kind, role, router]);

  if (status === "loading" || toOwnerHome || toRoleHome) {
    return (
      <FullScreen>
        <BrandMark className="size-14 animate-pulse text-xl" />
        <p className="text-sm text-muted-foreground">Cargando tu negocio…</p>
      </FullScreen>
    );
  }

  if (status === "error") {
    return (
      <FullScreen>
        <WifiOff className="size-8 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No se pudo conectar</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="flex gap-2">
          <Button onClick={() => void init()}>
            <RefreshCw /> Reintentar
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut /> Cerrar sesión
          </Button>
        </div>
      </FullScreen>
    );
  }

  if (profile?.role === "pendiente") {
    return (
      <FullScreen>
        <Hourglass className="size-8 text-gold" />
        <h2 className="text-xl font-semibold">Tu cuenta está pendiente</h2>
        <p className="text-sm text-muted-foreground">
          Hola {profile.name}. El dueño de <strong className="text-foreground">{active?.name ?? "tu negocio"}</strong> debe aprobar tu acceso y
          asignarte un puesto en Equipo. Cuando lo haga, vuelve a revisar.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void init()}>
            <RefreshCw /> Revisar de nuevo
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut /> Cerrar sesión
          </Button>
        </div>
      </FullScreen>
    );
  }

  if (membership?.state === "revision" || membership?.state === "rechazada") {
    const rejected = membership.state === "rechazada";
    return (
      <FullScreen>
        {rejected ? <Ban className="size-8 text-destructive" /> : <Hourglass className="size-8 text-gold" />}
        <h2 className="text-xl font-semibold">{rejected ? "Tu solicitud no fue aprobada" : "Tu cuenta está en revisión"}</h2>
        <p className="text-sm text-muted-foreground">
          {rejected
            ? `Hola ${profile?.name}. No pudimos aprobar el registro de tu negocio.`
            : `Hola ${profile?.name}. Recibimos la solicitud de tu negocio y la estamos revisando. Ten paciencia: en cuanto confirmemos tu cuenta podrás entrar al sistema.`}
        </p>
        {rejected && membership.suspendedReason && <p className="text-sm text-muted-foreground">Motivo: {membership.suspendedReason}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void init()}>
            <RefreshCw /> Revisar de nuevo
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut /> Cerrar sesión
          </Button>
          <OwnerLink />
          <AdminLink />
        </div>
      </FullScreen>
    );
  }

  if (membership && isBlocked(membership)) {
    return (
      <FullScreen>
        <CreditCard className="size-8 text-gold" />
        <h2 className="text-xl font-semibold">Realiza tu pago para continuar</h2>
        <p className="text-sm text-muted-foreground">
          {membership.state === "suspendida" ? "Tu cuenta está suspendida." : "Tu membresía venció."} Tus datos se conservan: en cuanto
          registremos tu pago, el sistema se reactiva.
          {profile?.role !== "dueno" && " Avísale al dueño del negocio."}
        </p>
        {membership.suspendedReason && <p className="text-sm text-muted-foreground">Motivo: {membership.suspendedReason}</p>}
        <div>
          <p className="text-3xl font-semibold tabular">{mxn(amountDue(membership))}</p>
          <p className="text-xs text-muted-foreground">{dueLabel(membership)}</p>
        </div>
        <PaymentInfo />
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void init()}>
            <RefreshCw /> Revisar de nuevo
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut /> Cerrar sesión
          </Button>
          <OwnerLink />
          {/* El administrador de la plataforma puede reactivarse a sí mismo */}
          <AdminLink />
        </div>
      </FullScreen>
    );
  }

  return <>{children}</>;
}

/** Marco con menú lateral (fijo en escritorio, cajón en celular) y barra superior; lo usan el negocio y la cuenta del dueño. */
export function ShellFrame({
  sidebar,
  brand,
  actions,
  notice,
  children,
}: {
  sidebar: (onNavigate?: () => void) => ReactNode;
  brand: ReactNode;
  actions: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-3 left-3 z-30 hidden w-64 overflow-hidden rounded-[26px] border border-sidebar-border bg-sidebar bg-(image:--glass-sheen) shadow-(--glass-shadow) backdrop-blur-[28px] backdrop-saturate-[1.85] print:hidden lg:block">
        {sidebar()}
      </aside>
      <div className="lg:pl-[17.5rem]">
        <div className="sticky top-0 z-20 print:hidden">
          {notice}
          <header className="mx-3 mt-3 flex h-14 items-center gap-3 rounded-[20px] border border-(--glass-edge) bg-card bg-(image:--glass-sheen) px-3 shadow-(--glass-shadow) backdrop-blur-[28px] backdrop-saturate-[1.85] md:px-4 lg:ml-0">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar bg-(image:--glass-sheen) p-0" showCloseButton={false}>
                <SheetTitle className="sr-only">Menú</SheetTitle>
                {sidebar(() => setOpen(false))}
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 items-center gap-2 lg:hidden">{brand}</div>
            <div className="ml-auto flex items-center gap-1.5">{actions}</div>
          </header>
        </div>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}

/** Rutas de boutique que el personal (vendedor o encargado) ve bloqueadas. */
const OWNER_ONLY = navFor("boutique", "dueno")
  .flatMap((g) => g.items)
  .filter((i) => i.ownerOnly)
  .map((i) => i.href);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const role = useErp((s) => s.role);
  const kind = useErp((s) => s.kind);
  const businessName = useBusinessName();
  const locked = kind === "boutique" && role !== "dueno" && OWNER_ONLY.some((p) => pathname.startsWith(p));

  if (isBare(pathname)) return <>{children}</>;

  return (
    <DataGate>
      <AccentTheme />
      <ShellFrame
        sidebar={(onNavigate) => <SidebarBody onNavigate={onNavigate} />}
        notice={<MembershipNotice />}
        brand={
          <>
            <BrandMark className="size-7 text-xs" />
            <span className="truncate font-display text-base font-bold uppercase tracking-[0.08em]">{businessName}</span>
          </>
        }
        actions={
          <>
            <AdminLink />
            <ThemeToggle />
            <UserMenu />
          </>
        }
      >
        {locked ? <Restricted /> : children}
      </ShellFrame>
    </DataGate>
  );
}
