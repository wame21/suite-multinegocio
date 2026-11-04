"use client";

import { BarChart3, CreditCard, Home, LogOut, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AdminLink, ShellFrame, ThemeToggle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SuiteLockup } from "@/components/ui/suite-lockup";
import { homeFor } from "@/lib/access";
import { KIND_LABEL } from "@/lib/constants";
import { STATE_LABELS } from "@/lib/membership";
import { canEnter } from "@/lib/owner";
import { errorMessage, useErp } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import type { OwnerBusiness } from "@/lib/types";
import { cn } from "@/lib/utils";

interface OwnerCtx {
  name: string;
  /** `null` mientras carga. */
  businesses: OwnerBusiness[] | null;
  reload: () => PromiseLike<unknown>;
  /** `set_active_business` + reinicio del store, y abre el panel del negocio. */
  enter: (b: OwnerBusiness) => Promise<void>;
  entering: string | null;
}

const Ctx = createContext<OwnerCtx | null>(null);

export function useOwner() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOwner va dentro de OwnerShell");
  return ctx;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();

const NAV = [
  { href: "/negocios", label: "Inicio", icon: Home },
  { href: "/negocios/finanzas", label: "Finanzas", icon: Wallet },
  { href: "/negocios/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/negocios/membresias", label: "Membresías", icon: CreditCard },
];

function OwnerSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { name, businesses, enter, entering } = useOwner();
  const link = (active: boolean) =>
    cn(
      "group flex h-11 items-center gap-3 rounded-[14px] px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      active && "bg-sidebar-primary/15 font-semibold text-sidebar-accent-foreground inset-ring inset-ring-sidebar-primary/45 hover:bg-sidebar-primary/20",
    );
  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto px-3 py-5 text-sidebar-foreground">
      <div className="flex flex-col gap-1 px-2">
        <SuiteLockup />
        <p className="truncate pl-12 text-xs text-sidebar-foreground/60">{name}</p>
      </div>
      <nav aria-label="Cuenta" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">General</div>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={onNavigate} className={link(active)}>
                <item.icon className={cn("size-[18px] shrink-0", active ? "text-gold" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80")} />
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="flex flex-col gap-1">
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">Negocios</div>
          {businesses?.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={!canEnter(b) || entering !== null}
              onClick={() => void enter(b)}
              className={cn(link(false), "h-auto w-full py-2 text-left disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-primary/15 text-[11px] font-bold text-gold ring-1 ring-sidebar-primary/35">
                {initialsOf(b.name)}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[13px]">{b.name}</span>
                <span className="block truncate text-[11px] font-normal text-sidebar-foreground/60">
                  {STATE_LABELS[b.state]} · {KIND_LABEL[b.kind]}
                </span>
              </span>
            </button>
          ))}
          <Link href="/negocios/nuevo" onClick={onNavigate} className={link(pathname === "/negocios/nuevo")}>
            <Plus className="size-[18px] shrink-0 text-gold" />
            Nuevo negocio
          </Link>
        </div>
      </nav>
    </div>
  );
}

function OwnerMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 gap-2 pl-1.5">
          <span className="grid size-6 place-items-center rounded-full bg-gold text-[11px] font-semibold text-gold-foreground">
            {name.charAt(0).toUpperCase()}
          </span>
          <span className="hidden text-xs font-medium sm:block">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => void useErp.getState().signOut()}>
          <LogOut /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Marco de la cuenta del dueño: no carga ningún negocio y suelta el que estuviera abierto. */
export function OwnerShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [businesses, setBusinesses] = useState<OwnerBusiness[] | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      supabase()
        .rpc("my_businesses")
        .then(({ data, error }) => (error ? toast.error(error.message) : setBusinesses(data as OwnerBusiness[]))),
    [],
  );

  useEffect(() => {
    // Al volver de un negocio no debe quedar nada de él en memoria ni su canal abierto.
    void useErp.getState().reset();
    void reload();
    void (async () => {
      const { data: auth } = await supabase().auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase().from("profiles").select("name").eq("id", auth.user.id).single();
      setName(data?.name ?? "");
    })();
  }, [reload]);

  const enter = useCallback(
    async (b: OwnerBusiness) => {
      setEntering(b.id);
      try {
        await useErp.getState().switchBusiness(b.id);
        router.push(homeFor(b.kind, "dueno"));
      } catch (e) {
        toast.error(errorMessage(e));
        setEntering(null);
      }
    },
    [router],
  );

  const value = useMemo(() => ({ name, businesses, reload, enter, entering }), [name, businesses, reload, enter, entering]);

  return (
    <Ctx.Provider value={value}>
      <ShellFrame
        sidebar={(onNavigate) => <OwnerSidebar onNavigate={onNavigate} />}
        brand={<SuiteLockup />}
        actions={
          <>
            <AdminLink />
            <ThemeToggle />
            <OwnerMenu name={name || "Mi cuenta"} />
          </>
        }
      >
        {children}
      </ShellFrame>
    </Ctx.Provider>
  );
}
