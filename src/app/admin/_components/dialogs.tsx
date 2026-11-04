"use client";

import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bankFromClabe, clabeError, onlyDigits } from "@/lib/clabe";
import { fDate, fDateTime, mxn } from "@/lib/format";
import { supabase } from "@/lib/supabase/client";
import type { BusinessKind, MembershipState } from "@/lib/types";

/** Fila de `admin_businesses()`. */
export type AdminBusiness = {
  id: string;
  name: string;
  kind: BusinessKind;
  owner_name: string | null;
  owner_email: string | null;
  state: MembershipState;
  ends_at: string | null;
  trial_ends_at: string | null;
  paid_until: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  members: number;
  orders_30d: number;
  created_at: string;
};

/** Fila única de `platform_settings`, con los precios ya como número. */
export type PlatformSettings = {
  price_monthly: number;
  price_setup: number;
  bank: string;
  clabe: string;
  holder: string;
  whatsapp: string;
};

export type Action = "pagar" | "suspender" | "rechazar" | "historial";

type Event = {
  id: string;
  at: string;
  actor_email: string | null;
  action: string;
  paid_until: string | null;
  amount: number | null;
  note: string | null;
};

type Run = () => PromiseLike<{ error: { message: string } | null }>;
type Props = { biz: AdminBusiness; onClose: () => void; onDone: () => void };

export function ActionDialog({
  target,
  settings,
  onClose,
  onDone,
}: {
  target: { biz: AdminBusiness; action: Action } | null;
  settings: PlatformSettings | null;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!target) return null;
  const { biz, action } = target;
  const props = { biz, onClose, onDone };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {action === "historial" ? (
          <History {...props} />
        ) : action === "pagar" ? (
          <Pay {...props} settings={settings} />
        ) : action === "rechazar" ? (
          <Reject {...props} />
        ) : (
          <Suspend {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Precios y datos de cobro: los negocios los ven en Membresía y en la pantalla de pago. */
export function SettingsDialog({ settings, onClose, onDone }: { settings: PlatformSettings; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ ...settings, price_monthly: String(settings.price_monthly), price_setup: String(settings.price_setup) });
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const clabe = onlyDigits(form.clabe);
  const clabeErr = clabeError(form.clabe);
  const monthly = Number(form.price_monthly);
  const setup = Number(form.price_setup);
  const invalid = !!clabeErr || form.price_monthly === "" || form.price_setup === "" || !(monthly >= 0) || !(setup >= 0);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <Shell
          title="Datos de cobro"
          description="Los negocios los ven en Configuración → Membresía y en la pantalla de pago."
          label="Guardar"
          disabled={invalid}
          run={() =>
            supabase()
              .from("platform_settings")
              .update({
                price_monthly: monthly,
                price_setup: setup,
                bank: form.bank.trim() || (bankFromClabe(clabe) ?? ""),
                clabe,
                holder: form.holder.trim(),
                whatsapp: form.whatsapp.trim(),
              })
              .eq("id", true)
              .select()
              .single()
          }
          ok="Datos de cobro guardados"
          onClose={onClose}
          onDone={onDone}
        >
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mensualidad (MXN)">
                {(id) => <Input id={id} type="number" min={0} value={form.price_monthly} onChange={set("price_monthly")} />}
              </Field>
              <Field label="Alta, pago único (MXN)">
                {(id) => <Input id={id} type="number" min={0} value={form.price_setup} onChange={set("price_setup")} />}
              </Field>
            </div>
            <Field label="CLABE">
              {(id) => <Input id={id} inputMode="numeric" value={form.clabe} onChange={set("clabe")} aria-invalid={!!clabeErr} placeholder="18 dígitos" />}
            </Field>
            {clabeErr && <p className="-mt-2 text-xs text-destructive">{clabeErr}</p>}
            <Field label="Banco">
              {(id) => <Input id={id} value={form.bank} onChange={set("bank")} placeholder={bankFromClabe(clabe) ?? "Se toma de la CLABE"} />}
            </Field>
            <Field label="Titular">{(id) => <Input id={id} value={form.holder} onChange={set("holder")} />}</Field>
            <Field label="WhatsApp">{(id) => <Input id={id} inputMode="tel" value={form.whatsapp} onChange={set("whatsapp")} placeholder="10 dígitos" />}</Field>
          </div>
        </Shell>
      </DialogContent>
    </Dialog>
  );
}

/** Encabezado, pie y envío comunes: toast con el mensaje del servidor si falla. */
function Shell({
  title,
  description,
  label,
  destructive,
  disabled,
  run,
  ok,
  onClose,
  onDone,
  children,
}: {
  title: string;
  description: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  run: Run;
  ok: string;
  onClose: () => void;
  onDone: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const { error } = await run();
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success(ok);
    onDone();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant={destructive ? "destructive" : "default"} disabled={busy || disabled} onClick={() => void submit()}>
          {label}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Liga la etiqueta a su control: `children` recibe el id que debe llevar. */
function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

/** Marcar como pagado: el monto se sugiere con la mensualidad por mes, más el alta si es el primer pago. */
function Pay({ biz, settings, onClose, onDone }: Props & { settings: PlatformSettings | null }) {
  const first = !biz.paid_until;
  const monthly = settings?.price_monthly ?? 0;
  const setupFee = settings?.price_setup ?? 0;
  const suggested = (months: number) => (months >= 1 ? months * monthly + (first ? setupFee : 0) : 0);
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState(String(suggested(1)));
  const [note, setNote] = useState(first ? "Alta + primera mensualidad" : "");
  const m = Math.floor(Number(months));
  return (
    <Shell
      title="Marcar como pagado"
      description={first ? `${biz.name} · primer pago: incluye el alta de ${mxn(setupFee)}` : biz.name}
      label="Marcar pagado"
      disabled={!(m >= 1)}
      run={() => supabase().rpc("admin_mark_paid", { p_business: biz.id, p_months: m, p_amount: Number(amount) || 0, p_note: note.trim() || null })}
      ok="Pago registrado"
      onClose={onClose}
      onDone={onDone}
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Meses">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                step={1}
                value={months}
                onChange={(e) => {
                  setMonths(e.target.value);
                  setAmount(String(suggested(Math.floor(Number(e.target.value)))));
                }}
              />
            )}
          </Field>
          <Field label="Monto (MXN)">
            {(id) => <Input id={id} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </div>
        <Field label="Nota">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transferencia, referencia…" />}
        </Field>
      </div>
    </Shell>
  );
}

function Suspend({ biz, onClose, onDone }: Props) {
  const [reason, setReason] = useState("");
  return (
    <Shell
      title="Suspender negocio"
      description={`${biz.name} verá solo la pantalla de pago; sus datos se conservan y puedes reactivarlo cuando quieras.`}
      label="Suspender"
      destructive
      run={() => supabase().rpc("admin_suspend", { p_business: biz.id, p_reason: reason.trim() })}
      ok="Negocio suspendido"
      onClose={onClose}
      onDone={onDone}
    >
      <Field label="Motivo (opcional, lo ve el negocio)">
        {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Falta de pago, prueba…" />}
      </Field>
    </Shell>
  );
}

function Reject({ biz, onClose, onDone }: Props) {
  const [reason, setReason] = useState("");
  return (
    <Shell
      title="Rechazar solicitud"
      description={`${biz.name} no podrá entrar al sistema. No se borra nada: puedes aceptarlo después.`}
      label="Rechazar"
      destructive
      run={() => supabase().rpc("admin_reject", { p_business: biz.id, p_reason: reason.trim() })}
      ok="Solicitud rechazada"
      onClose={onClose}
      onDone={onDone}
    >
      <Field label="Motivo (opcional, lo ve el negocio)">
        {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Datos incompletos, negocio duplicado…" />}
      </Field>
    </Shell>
  );
}

function History({ biz }: Props) {
  const [events, setEvents] = useState<Event[] | null>(null);
  useEffect(() => {
    void supabase()
      .rpc("admin_events", { p_business: biz.id })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setEvents((data as Event[] | null) ?? []);
      });
  }, [biz.id]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Historial</DialogTitle>
        <DialogDescription>{biz.name}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-y-auto">
        {events === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos todavía.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Pagado hasta</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">
                    {fDateTime(e.at)}
                    <div className="text-xs text-muted-foreground">{e.actor_email}</div>
                  </TableCell>
                  <TableCell>{e.action}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.paid_until ? fDate(e.paid_until) : "—"}</TableCell>
                  <TableCell className="text-right">{e.amount ? mxn(e.amount) : "—"}</TableCell>
                  <TableCell>{e.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
