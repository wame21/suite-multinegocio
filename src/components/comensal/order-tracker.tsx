"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { mxnCents } from "@/lib/format";
import { fetchOrderStatus, notifyTransfer, type PublicOrderStatus, type TableOrderStatus } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { bigButton, LineList, Mark, Screen, Unavailable } from "./frame";

const POLL_MS = 5000;
const FINAL: TableOrderStatus[] = ["entregado", "cancelado"];
const BADGE: Record<TableOrderStatus, string> = {
  por_pagar: "Por pagar", pagado: "Pagado", en_preparacion: "En preparación", terminado: "Terminado", entregado: "Entregado", cancelado: "Cancelado",
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

/** Pantallas E06 a E11: el pedido del comensal según su estado, consultado cada 5 s mientras siga abierto. */
export function OrderTracker({ token, tracking }: { token: string; tracking: string }) {
  const [order, setOrder] = useState<PublicOrderStatus | null | undefined>();
  const [failed, setFailed] = useState(false);
  const status = order?.status;
  const missing = order === null;

  useEffect(() => {
    if (status && FINAL.includes(status)) return;
    let live = true;
    const load = () =>
      fetchOrderStatus(tracking).then(
        (o) => live && (setOrder(o), setFailed(false)),
        () => live && setFailed(true),
      );
    load();
    // un pedido inexistente (null) no cambia solo: se deja de preguntar
    const id = missing ? undefined : setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [tracking, status, missing]);

  if (order === undefined) {
    return failed ? (
      <Unavailable title="No pudimos cargar tu pedido" text="Revisa tu conexión; lo intentamos de nuevo en unos segundos." />
    ) : (
      <Screen><Skeleton className="mt-16 h-48 w-full rounded-2xl" aria-label="Cargando tu pedido" /></Screen>
    );
  }
  if (order === null) {
    return (
      <Unavailable
        title="No encontramos este pedido"
        text="El enlace no es válido. Pide ayuda al personal."
        action={<Button asChild variant="outline" className="h-11"><Link href={`/m/${token}`}>Volver al menú</Link></Button>}
      />
    );
  }
  return <Order token={token} tracking={tracking} order={order} onChange={setOrder} stale={failed} />;
}

function hero(o: PublicOrderStatus): { title: string; text: string } {
  const who = o.customerName;
  switch (o.status) {
    case "por_pagar":
      if (o.paymentMethod === "tarjeta" && o.cardAtTable) return { title: "Un mesero llevará la terminal a tu mesa", text: "Ten lista tu tarjeta. En cuanto se cobre, tu pedido pasa a cocina." };
      if (o.paymentMethod === "tarjeta") return { title: "Pasa a caja para pagar con tarjeta", text: "Di tu nombre o el folio. En cuanto se cobre, tu pedido pasa a cocina." };
      if (o.paymentMethod === "efectivo") return { title: "Paga en caja o con tu mesero", text: "Di tu nombre o el folio. En cuanto se cobre, tu pedido pasa a cocina." };
      return { title: "Estamos confirmando tu pago", text: `Caja revisa tu transferencia de ${mxnCents(o.total)}. Suele tardar menos de un minuto; esta pantalla se actualiza sola.` };
    case "pagado": return { title: "Pago confirmado", text: "Tu pedido pasa a cocina en un momento." };
    case "en_preparacion": return { title: "Estamos preparando tu pedido", text: "Pago confirmado. Aquí verás cuando esté listo." };
    case "terminado": return { title: `¡Tu pedido está listo, ${who}!`, text: `Un mesero lo lleva a tu mesa ${o.table} en un momento. ¡Buen provecho!` };
    case "entregado": return { title: "Tu pedido fue entregado", text: "¡Buen provecho!" };
    case "cancelado": return { title: "Tu pedido fue cancelado", text: "Si crees que es un error, pide ayuda al personal." };
  }
}

function payStep(o: PublicOrderStatus) {
  if (o.paidAt) return { label: "Pagado", sub: hhmm(o.paidAt) };
  if (o.paymentMethod === "tarjeta") return { label: o.cardAtTable ? "Pago con terminal" : "Pago en caja", sub: undefined };
  if (o.paymentMethod === "efectivo") return { label: "Pago en caja", sub: undefined };
  return { label: "Confirmando pago", sub: o.transferNotified ? "Transferencia · avisaste" : "Transferencia" };
}

function Order({ token, tracking, order: o, onChange, stale }: { token: string; tracking: string; order: PublicOrderStatus; onChange: (o: PublicOrderStatus | null) => void; stale: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { title, text } = hero(o);
  const pay = payStep(o);
  const cancelled = o.status === "cancelado";
  const steps = [
    { label: "Pedido enviado", at: o.createdAt, sub: hhmm(o.createdAt) },
    { label: pay.label, at: o.paidAt, sub: pay.sub },
    { label: "En preparación", at: o.preparingAt, sub: o.preparingAt ? `desde ${hhmm(o.preparingAt)}` : undefined },
    { label: "Terminado", at: o.readyAt, sub: o.readyAt ? hhmm(o.readyAt) : undefined },
  ];
  const now = steps.findIndex((s) => !s.at);
  const showTransfer = o.status === "por_pagar" && o.paymentMethod === "transferencia" && o.transfer;

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      setCopied(null); // sin permiso de portapapeles: la CLABE sigue visible para copiarla a mano
    }
  };

  async function iTransferred() {
    setSending(true);
    setError(null);
    try {
      await notifyTransfer(tracking);
      onChange(await fetchOrderStatus(tracking));
    } catch (e) {
      setError((e as Error).message);
    }
    setSending(false);
  }

  return (
    <Screen
      top={
        <>
          <Mark name={o.business} />
          <div className="min-w-0 grow">
            <div className="truncate font-semibold">Pedido {o.folio}</div>
            <div className="truncate text-xs text-muted-foreground">{o.table} · {o.customerName}</div>
          </div>
          <Badge variant={cancelled ? "destructive" : "secondary"}>{BADGE[o.status]}</Badge>
        </>
      }
      foot={
        showTransfer && !o.transferNotified ? (
          <>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="button" disabled={sending} onClick={iTransferred} className={bigButton + " justify-center"}>{sending ? "Avisando…" : "Ya transferí"}</Button>
          </>
        ) : (
          <Button asChild variant="outline" className={bigButton + " justify-center"}><Link href={`/m/${token}`}>Pedir algo más</Link></Button>
        )
      }
    >
      <Card className="items-center gap-3 p-6 text-center">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">{text}</p>
        {o.status === "por_pagar" && (
          <div className="flex gap-6">
            <div><div className="text-xs text-muted-foreground">Folio</div><strong className="font-mono text-2xl">{o.folio}</strong></div>
            <div><div className="text-xs text-muted-foreground">Total</div><strong className="text-2xl tabular-nums">{mxnCents(o.total)}</strong></div>
          </div>
        )}
      </Card>

      {showTransfer && o.transfer && (
        <Card className="gap-3 p-5 text-sm">
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Monto exacto</span><strong className="text-2xl tabular-nums">{mxnCents(o.total)}</strong></div>
          <Copyable label="CLABE" value={o.transfer.clabe} copied={copied === "clabe"} onCopy={() => copy("clabe", o.transfer!.clabe)} />
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Banco</span><span className="text-right">{o.transfer.bank}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Titular</span><span className="text-right">{o.transfer.holder}</span></div>
          <Copyable label="Concepto" value={o.folio} copied={copied === "folio"} onCopy={() => copy("folio", o.folio)} />
          <p className="text-xs text-muted-foreground">Usa el folio como concepto. Caja revisa que llegue y tu pedido pasa a cocina.</p>
        </Card>
      )}

      {!cancelled && (
        <ol className="flex flex-col gap-4" aria-label="Estado del pedido">
          {steps.map((s, i) => (
            <li key={s.label} className={cn("flex items-center gap-3", !s.at && i !== now && "opacity-50")} aria-current={i === now ? "step" : undefined}>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold", s.at && "border-success bg-success/20 text-success", i === now && "border-gold text-gold")}>
                {s.at ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span>
                <span className={cn("block font-semibold", i === now && "text-gold")}>{s.label}</span>
                {s.sub && <span className="block text-xs text-muted-foreground">{s.sub}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      <LineList lines={o.items.map((l, i) => ({ key: String(i), qty: l.qty, name: l.name, options: l.options, note: l.note, total: mxnCents(l.lineTotal) }))} />
      {o.note && <p className="text-sm text-muted-foreground">Nota del pedido: {o.note}</p>}
      <div className="flex items-center justify-between border-t pt-3"><span className="font-semibold">Total</span><span className="text-xl font-bold tabular-nums">{mxnCents(o.total)}</span></div>
      {stale && <p className="text-xs text-muted-foreground" role="status">Sin conexión; seguimos intentando.</p>}
    </Screen>
  );
}

function Copyable({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center justify-between gap-3">
        <strong className="break-all font-mono text-base tracking-wide">{value}</strong>
        <Button type="button" variant="outline" className="h-11 shrink-0 px-4" onClick={onCopy}>{copied ? "Copiado" : "Copiar"}</Button>
      </div>
    </div>
  );
}
