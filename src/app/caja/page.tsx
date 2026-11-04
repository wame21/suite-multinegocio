"use client";

import { Check, Landmark, X } from "lucide-react";
import { useState } from "react";
import { EmptyState, PageHeader } from "@/components/erp";
import { useNow, useRestaurantLive } from "@/components/restaurante/live";
import { agoLabel, groupByStatus, METHOD_NAME, minutesSince } from "@/components/restaurante/orders";
import { LiveGate, OrderLines, StatusPill, tableLabel, tableNames } from "@/components/restaurante/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mxnCents } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "cobrar" | "cobrados" | "cancelados";

export default function CajaPage() {
  const live = useRestaurantLive();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("cobrar");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const from = new Date(now).setHours(0, 0, 0, 0);
  const g = groupByStatus(live.orders);
  const lists: Record<Tab, typeof live.orders> = {
    cobrar: g.por_pagar,
    cobrados: live.orders.filter((o) => o.paidAt && Date.parse(o.paidAt) >= from),
    cancelados: g.cancelado.filter((o) => o.cancelledAt && Date.parse(o.cancelledAt) >= from),
  };
  const list = lists[tab];
  const order = list.find((o) => o.id === selected) ?? list[0];
  const names = tableNames(live.tables);
  const atTable = g.por_pagar.filter((o) => o.cardAtTable).length;

  const TABS: [Tab, string][] = [
    ["cobrar", "Por cobrar"],
    ["cobrados", "Cobrados hoy"],
    ["cancelados", "Cancelados"],
  ];

  return (
    <>
      <PageHeader title="Caja" description="Confirma el pago y el pedido pasa a cocina." />
      <LiveGate live={live}>
        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map(([key, label]) => (
            <Button key={key} variant={tab === key ? "default" : "outline"} size="sm" onClick={() => { setTab(key); setSelected(null); setConfirmCancel(false); }}>
              {label} · {lists[key].length}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_1fr]">
          <div className="grid content-start gap-2">
            {list.length === 0 && (
              <Card>
                <EmptyState icon={Landmark} title={tab === "cobrar" ? "Nada por cobrar" : "Sin pedidos"}>
                  Los pedidos nuevos aparecen aquí solos.
                </EmptyState>
              </Card>
            )}
            {list.map((o) => (
              <button
                key={o.id}
                onClick={() => { setSelected(o.id); setConfirmCancel(false); }}
                className={cn("rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted/50", o.id === order?.id && "border-gold/60 bg-gold/5")}
              >
                <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                  <span>
                    {o.folio} · {tableLabel(names.get(o.tableId))}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">{agoLabel(minutesSince(o.createdAt, now))}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-muted-foreground">
                    {o.customerName} · {o.items.reduce((n, l) => n + l.qty, 0)} productos
                  </span>
                  <span className="font-semibold tabular">{mxnCents(o.total)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{METHOD_NAME[o.paymentMethod]}{o.paymentMethod === "tarjeta" && (o.cardAtTable ? " · terminal en la mesa" : " · pasa a caja")}</Badge>
                  {o.transferNoticeAt && <Badge className="bg-gold/15 text-gold">Marcó «ya transferí»</Badge>}
                </div>
              </button>
            ))}
            {tab === "cobrar" && atTable > 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                {atTable} {atTable === 1 ? "pago con terminal en la mesa lo confirma" : "pagos con terminal en la mesa los confirma"} el mesero.
              </p>
            )}
          </div>

          {order && (
            <Card className="content-start gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">
                    Pedido {order.folio} <span className="text-muted-foreground">· {tableLabel(names.get(order.tableId))}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {order.customerName} · {new Date(order.createdAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <StatusPill status={order.status} />
              </div>
              <OrderLines order={order} prices />
              <div className="flex items-baseline justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-2xl font-semibold tabular">{mxnCents(order.total)}</span>
              </div>
              <p className="text-sm">
                <span className="text-muted-foreground">Método: </span>
                {METHOD_NAME[order.paymentMethod]}
                {order.paymentMethod === "tarjeta" && (order.cardAtTable ? " · un mesero lleva la terminal a la mesa" : " · el cliente pasa a caja")}
              </p>
              {order.transferNoticeAt && order.status === "por_pagar" && (
                <p className="rounded-xl bg-gold/10 p-3 text-sm text-gold">El cliente marcó «ya transferí»: confirma el depósito en tu banco antes de cobrar.</p>
              )}
              {order.status === "por_pagar" && (
                <div className="flex flex-wrap justify-end gap-2">
                  {confirmCancel ? (
                    <>
                      <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Volver</Button>
                      <Button variant="destructive" disabled={live.busy === order.id} onClick={() => { void live.move(order.id, "cancelado", "Pedido cancelado"); setConfirmCancel(false); }}>
                        <X /> Sí, cancelar pedido
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => setConfirmCancel(true)}>Cancelar pedido</Button>
                  )}
                  <Button disabled={live.busy === order.id} onClick={() => void live.move(order.id, "pagado", "Pago confirmado: el pedido pasa a cocina")}>
                    <Check /> Confirmar pago y enviar a cocina
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      </LiveGate>
    </>
  );
}
