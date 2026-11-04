"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/erp";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatClabe } from "@/lib/clabe";
import { KIND_LABEL } from "@/lib/constants";
import { fDate, mxn } from "@/lib/format";
import { daysLeft } from "@/lib/membership";
import { nextPayment, type Memberships } from "@/lib/owner";
import { supabase } from "@/lib/supabase/client";
import { StateBadge } from "../_components/state-badge";

/** Avisa de la prueba cuando faltan estos días o menos. */
const TRIAL_NOTICE_DAYS = 7;

const PAY_FIELDS = [
  ["bank", "Banco"],
  ["clabe", "CLABE"],
  ["holder", "Titular"],
  ["whatsapp", "Envía tu comprobante por WhatsApp"],
] as const;

export default function NegociosMembresiasPage() {
  const [m, setM] = useState<Memberships | null>(null);

  useEffect(() => {
    void supabase()
      .rpc("my_memberships")
      .then(({ data, error }) => (error ? toast.error(error.message) : setM(data as Memberships)));
  }, []);

  if (!m) return <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />;
  const trials = m.businesses.filter((b) => b.state === "prueba" && (daysLeft(b.trialEndsAt) ?? Infinity) <= TRIAL_NOTICE_DAYS);

  return (
    <>
      <PageHeader title="Membresías" description={`Cada negocio paga su mensualidad: ${mxn(m.priceMonthly)} al mes, alta única de ${mxn(m.priceSetup)}.`} />
      <div className="grid gap-4">
        {trials.map((b) => (
          <div key={b.id} role="status" className="flex items-start gap-3 rounded-xl bg-warning/12 px-4 py-3 text-sm ring-1 ring-warning/30">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <strong>La prueba de {b.name} termina el {fDate(b.trialEndsAt!)}</strong>
              <p className="text-muted-foreground">
                Registra el alta y la primera mensualidad ({mxn(nextPayment(b, m)!)}) para no interrumpir su operación.
              </p>
            </div>
          </div>
        ))}
        <Card className="gap-3 px-0">
          {m.businesses.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Aún no tienes negocios.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Negocio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Próximo pago</TableHead>
                  <TableHead className="pr-4">Último pago</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.businesses.map((b) => {
                  const due = nextPayment(b, m);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground">{KIND_LABEL[b.kind]}</div>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={b.state} endsAt={b.endsAt} />
                        {b.state === "rechazada" && b.suspendedReason && <div className="mt-1 text-xs text-destructive">Motivo: {b.suspendedReason}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{b.endsAt ? fDate(b.endsAt) : "—"}</TableCell>
                      <TableCell className="text-right tabular">
                        {due === null ? <span className="text-muted-foreground">Al activarse</span> : mxn(due)}
                        {due !== null && !b.paidUntil && <div className="text-xs text-muted-foreground">alta + 1er mes</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap pr-4">
                        {b.lastPayment ? `${fDate(b.lastPayment.at)}${b.lastPayment.note ? ` · ${b.lastPayment.note}` : ""}` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card className="gap-3 px-4">
          <h2 className="font-semibold">Datos para pagar</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            {PAY_FIELDS.filter(([k]) => m.payment[k]).map(([k, label]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular">{k === "clabe" ? formatClabe(m.payment.clabe) : m.payment[k]}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">Indica en el concepto el nombre del negocio. Registramos el pago en cuanto lo confirmamos.</p>
        </Card>
      </div>
    </>
  );
}
