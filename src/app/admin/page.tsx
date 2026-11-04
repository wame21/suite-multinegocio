"use client";

import { Ban, Check, Landmark, LogOut, MoreHorizontal, RotateCcw, Search, Store, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/erp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SuiteLockup } from "@/components/ui/suite-lockup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KIND_LABEL } from "@/lib/constants";
import { fDate, mxn } from "@/lib/format";
import { STATE_LABELS, daysLeft } from "@/lib/membership";
import { supabase } from "@/lib/supabase/client";
import type { BusinessKind, MembershipState } from "@/lib/types";
import { ActionDialog, SettingsDialog, type Action, type AdminBusiness, type PlatformSettings } from "./_components/dialogs";

const STATES = Object.keys(STATE_LABELS) as MembershipState[];

const BADGE: Record<MembershipState, "default" | "secondary" | "outline" | "destructive"> = {
  revision: "outline",
  rechazada: "destructive",
  activa: "default",
  prueba: "secondary",
  gracia: "outline",
  vencida: "destructive",
  suspendida: "destructive",
};

/** Etiqueta del estado con los días que le quedan a la prueba o a la gracia. */
function stateText(b: AdminBusiness) {
  const days = b.state === "prueba" || b.state === "gracia" ? daysLeft(b.ends_at) : null;
  return days === null ? STATE_LABELS[b.state] : `${STATE_LABELS[b.state]} · ${days} ${days === 1 ? "día" : "días"}`;
}

export default function AdminPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AdminBusiness[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<MembershipState | "todos">("todos");
  const [kind, setKind] = useState<BusinessKind | "todos">("todos");
  const [target, setTarget] = useState<{ biz: AdminBusiness; action: Action } | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);

  const load = useCallback(async () => {
    const [biz, cfg] = await Promise.all([
      supabase().rpc("admin_businesses"),
      supabase().from("platform_settings").select("price_monthly, price_setup, bank, clabe, holder, whatsapp").single(),
    ]);
    if (biz.error) toast.error(biz.error.message);
    if (cfg.error) toast.error(cfg.error.message);
    setRows((biz.data as AdminBusiness[] | null) ?? []);
    // numeric de Postgres puede llegar como texto
    if (cfg.data) setSettings({ ...cfg.data, price_monthly: Number(cfg.data.price_monthly), price_setup: Number(cfg.data.price_setup) });
  }, []);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase().rpc("is_platform_admin");
      if (data !== true) return router.replace("/");
      await load();
    })();
  }, [router, load]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<MembershipState, number>;
    for (const r of rows ?? []) c[r.state]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (filter === "todos" || r.state === filter) &&
        (kind === "todos" || r.kind === kind) &&
        (!t || `${r.name} ${r.owner_name ?? ""} ${r.owner_email ?? ""}`.toLowerCase().includes(t)),
    );
  }, [rows, q, filter, kind]);

  const quick = async (fn: "admin_reactivate" | "admin_approve", b: AdminBusiness, ok: string) => {
    const { error } = await supabase().rpc(fn, { p_business: b.id });
    if (error) return void toast.error(error.message);
    toast.success(ok);
    await load();
  };

  const signOut = async () => {
    await supabase().auth.signOut();
    // Recarga completa para no dejar datos en memoria (igual que el cierre de sesión del ERP).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- se busca descartar el estado en memoria
    window.location.assign("/login");
  };

  return (
    <div className="min-h-screen">
      <header className="m-3 flex items-center justify-between gap-3 rounded-[20px] border border-sidebar-border bg-sidebar bg-(image:--glass-sheen) px-4 py-3 text-sidebar-foreground shadow-(--glass-shadow) backdrop-blur-[28px] backdrop-saturate-[1.85]">
        <SuiteLockup />
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm" className="text-foreground" aria-label="Ir a mis negocios">
            <Link href="/negocios">
              <Store /> <span className="hidden sm:inline">Ir a mis negocios</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="text-foreground" aria-label="Cerrar sesión" onClick={() => void signOut()}>
            <LogOut /> <span className="hidden sm:inline">Cerrar sesión</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <PageHeader
          title="Administración de la plataforma"
          description={
            settings
              ? `Negocios, membresías y pagos · ${mxn(settings.price_monthly)} al mes, alta de ${mxn(settings.price_setup)}.`
              : "Negocios, membresías y pagos."
          }
          actions={
            <Button variant="outline" size="sm" disabled={!settings} onClick={() => setEditingSettings(true)}>
              <Landmark /> Datos de cobro
            </Button>
          }
        />

        <div className="mb-4 flex flex-wrap gap-2">
          {STATES.map((s) => (
            <Badge key={s} variant={BADGE[s]}>
              {STATE_LABELS[s]}: {counts[s]}
            </Badge>
          ))}
        </div>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar por negocio o correo" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={kind} onValueChange={(v) => setKind(v as BusinessKind | "todos")}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Giro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los giros</SelectItem>
              {(Object.keys(KIND_LABEL) as BusinessKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={(v) => setFilter(v as MembershipState | "todos")}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden p-0">
          {rows === null ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : shown.length === 0 ? (
            <EmptyState icon={Search} title="Sin resultados" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Negocio</TableHead>
                  <TableHead>Giro</TableHead>
                  <TableHead>Dueño</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Usuarios</TableHead>
                  <TableHead className="text-right">Pedidos 30 d</TableHead>
                  <TableHead>Alta</TableHead>
                  <TableHead className="sticky right-0 bg-background" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((b) => {
                  // Solicitud de alta: la prueba aún no corre, empieza al aceptarla.
                  const request = b.state === "revision" || b.state === "rechazada";
                  const due = request ? null : (b.paid_until ?? b.trial_ends_at);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="pl-4 font-medium">{b.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{KIND_LABEL[b.kind]}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {b.owner_name}
                        <div className="text-xs text-muted-foreground">{b.owner_email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={BADGE[b.state]} className="whitespace-nowrap">
                          {stateText(b)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{due ? fDate(due) : "—"}</TableCell>
                      <TableCell className="text-right">{b.members}</TableCell>
                      <TableCell className="text-right">{b.orders_30d}</TableCell>
                      <TableCell className="whitespace-nowrap">{fDate(b.created_at)}</TableCell>
                      <TableCell className="sticky right-0 bg-background">
                        <div className="flex items-center justify-end gap-1">
                          {request ? (
                            <>
                              <Button variant="outline" size="sm" onClick={() => void quick("admin_approve", b, "Negocio aceptado")}>
                                <Check /> Aceptar
                              </Button>
                              {b.state === "revision" && (
                                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setTarget({ biz: b, action: "rechazar" })}>
                                  <X /> Rechazar
                                </Button>
                              )}
                            </>
                          ) : b.state === "suspendida" ? (
                            <Button variant="outline" size="sm" onClick={() => void quick("admin_reactivate", b, "Negocio reactivado")}>
                              <RotateCcw /> Reactivar
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setTarget({ biz: b, action: "suspender" })}>
                              <Ban /> Suspender
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Acciones de ${b.name}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setTarget({ biz: b, action: "pagar" })}>
                                Marcar como pagado
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setTarget({ biz: b, action: "historial" })}>Historial</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>
      {editingSettings && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setEditingSettings(false)}
          onDone={() => {
            setEditingSettings(false);
            void load();
          }}
        />
      )}
      <ActionDialog
        target={target}
        settings={settings}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          void load();
        }}
      />
    </div>
  );
}
