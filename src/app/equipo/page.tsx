"use client";

import { Check, Copy, RefreshCw, UserCog } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/erp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { navFor } from "@/lib/access";
import { fDate } from "@/lib/format";
import { errorMessage, useActiveBranches, useBranches, useErp } from "@/lib/store";
import type { AppRole, BranchId, Profile, Role } from "@/lib/types";

const ROLE_LABEL: Record<AppRole, string> = {
  dueno: "Dueño",
  vendedor: "Vendedor",
  encargado: "Encargado",
  mesero: "Mesero",
  cajero: "Cajero",
  cocina: "Cocina",
  pendiente: "Pendiente",
};

/** Valor del selector para "sin sucursal" (Radix no admite valores vacíos). */
const NO_BRANCH = "none";

/** Puestos que el dueño puede asignar según el giro. */
const ASSIGNABLE = { boutique: ["vendedor", "encargado"], restaurante: ["mesero", "cajero", "cocina"] } as const;
const APPROVED_ROLES: Role[] = ["dueno", "cajero", "mesero", "cocina"];

export default function EquipoPage() {
  const team = useErp((s) => s.team);
  const loadTeam = useErp((s) => s.loadTeam);
  const me = useErp((s) => s.profile?.id);
  const resto = useErp((s) => s.kind) === "restaurante";

  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadTeam().catch((e) => {
      setLoadError(true);
      toast.error(errorMessage(e));
    });
  }, [loadTeam]);

  const pendientes = team.filter((m) => m.role === "pendiente").length;

  return (
    <>
      <PageHeader
        title="Equipo"
        description={
          resto
            ? "Cada quien ve solo lo que necesita para su puesto. Quien se registra con el código queda pendiente: asígnale Mesero, Cajero o Cocina."
            : "Quien se registra con el código de tu negocio queda pendiente. Apruébalo como vendedor o encargado y asígnale su sucursal; ninguno ve costos, utilidades ni gastos. El encargado además mueve inventario y cancela pedidos."
        }
      />
      <InviteCard />
      {pendientes > 0 && (
        <p className="mb-4 text-sm text-gold">
          {pendientes} {pendientes === 1 ? "persona espera" : "personas esperan"} tu aprobación.
        </p>
      )}
      <Card className="py-0">
        {team.length === 0 ? (
          <EmptyState icon={UserCog} title={loadError ? "No se pudo cargar el equipo" : "Cargando equipo…"} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Nombre</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead>Rol</TableHead>
                {!resto && <TableHead className="pr-4">Sucursal</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((m) => (
                <MemberRow key={m.id} member={m} self={m.id === me} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {resto && <RoleMatrix />}
    </>
  );
}

function InviteCard() {
  const code = useErp((s) => s.business?.inviteCode);
  const regenerate = useErp((s) => s.regenerateInviteCode);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!code) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("No se pudo copiar; selecciona el código y cópialo a mano");
    }
  };

  const renew = async () => {
    setBusy(true);
    try {
      await regenerate();
      toast.success("Código nuevo generado; el anterior ya no sirve");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="mb-6 gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Código de invitación</div>
          <div className="select-all font-mono text-2xl font-semibold tracking-[0.25em] gold-text">{code}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
          {confirming ? (
            <>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void renew()}>
                <RefreshCw className={busy ? "animate-spin" : undefined} />
                Sí, generar nuevo
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <RefreshCw />
              Generar nuevo código
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Para invitar a alguien, compártele este código. Debe elegir «Registrarme → Unirme a un negocio» al crear su cuenta y
        escribirlo. Quedará pendiente hasta que lo apruebes aquí. Si generas un código nuevo, el anterior deja de funcionar.
      </p>
    </Card>
  );
}

/** Qué módulos abre cada puesto del restaurante: sale del mismo menú que usa la barra lateral. */
function RoleMatrix() {
  const modules = navFor("restaurante", "dueno").flatMap((g) => g.items);
  return (
    <Card className="mt-6 gap-3 p-4">
      <h2 className="text-sm font-semibold">Qué ve cada puesto</h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Puesto</TableHead>
              {modules.map((m) => (
                <TableHead key={m.href} className="text-center">{m.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {APPROVED_ROLES.map((role) => {
              const mine = new Set(navFor("restaurante", role).flatMap((g) => g.items.map((i) => i.href)));
              return (
                <TableRow key={role}>
                  <TableCell className="font-medium">{ROLE_LABEL[role]}</TableCell>
                  {modules.map((m) => (
                    <TableCell key={m.href} className={mine.has(m.href) ? "text-center text-success" : "text-center text-muted-foreground/50"}>
                      {mine.has(m.href) ? "✓" : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function MemberRow({ member, self }: { member: Profile; self: boolean }) {
  const setMember = useErp((s) => s.setMember);
  const resto = useErp((s) => s.kind) === "restaurante";
  const active = useActiveBranches();
  const all = useBranches();
  const [saving, setSaving] = useState(false);
  const locked = self || member.role === "dueno";

  // Si la sucursal asignada se archivó sigue apareciendo hasta que se cambie.
  const archived = member.branch && !active.some((b) => b.id === member.branch) ? all.find((b) => b.id === member.branch) : undefined;

  const save = async (role: AppRole, branch: BranchId | null) => {
    setSaving(true);
    try {
      await setMember(member.id, role, branch);
      toast.success(
        role !== "pendiente" && member.role === "pendiente" ? `${member.name} ya puede entrar` : `${member.name} actualizado`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="font-medium">
          {member.name} {self && <span className="text-xs text-muted-foreground">(tú)</span>}
        </div>
        <div className="text-xs text-muted-foreground">{member.email}</div>
      </TableCell>
      <TableCell className="text-muted-foreground">{fDate(member.createdAt)}</TableCell>
      <TableCell>
        {locked ? (
          <Badge variant="outline" className="border-gold/40 text-gold">
            {ROLE_LABEL[member.role]}
          </Badge>
        ) : (
          <Select value={member.role} disabled={saving} onValueChange={(v) => void save(v as AppRole, member.branch)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE[resto ? "restaurante" : "boutique"].map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
              ))}
              <SelectItem value="pendiente">Pendiente (sin acceso)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </TableCell>
      {!resto && <TableCell className="pr-4">
        {locked ? (
          <span className="text-muted-foreground">Todas</span>
        ) : (
          <Select
            value={member.branch ?? NO_BRANCH}
            disabled={saving}
            onValueChange={(v) => void save(member.role, v === NO_BRANCH ? null : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BRANCH}>Sin sucursal</SelectItem>
              {active.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.short}
                </SelectItem>
              ))}
              {archived && (
                <SelectItem value={archived.id} disabled>
                  {archived.short} (archivada)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </TableCell>}
    </TableRow>
  );
}
