"use client";

import { Check, CreditCard, PackageCheck, Settings2 } from "lucide-react";
import Link from "next/link";
import { PageHeader, SectionTitle } from "@/components/erp";
import { useNow, useRestaurantLive } from "@/components/restaurante/live";
import { agoLabel, isOpen, minutesSince, stageSince, tableState, type TableState } from "@/components/restaurante/orders";
import { LiveGate, tableLabel, tableNames } from "@/components/restaurante/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mxnCents } from "@/lib/format";
import { useIsOwner } from "@/lib/store";
import { cn } from "@/lib/utils";

const STATE: Record<TableState, { label: string; box: string }> = {
  libre: { label: "Libre", box: "bg-muted/40 text-muted-foreground ring-border" },
  cobrar: { label: "Por cobrar", box: "bg-destructive/10 text-destructive ring-destructive/30" },
  terminal: { label: "Llevar terminal", box: "bg-ch-web/10 text-ch-web ring-ch-web/35" },
  cocina: { label: "En cocina", box: "bg-gold/10 text-gold ring-gold/35" },
  listo: { label: "Listo para entregar", box: "bg-success/10 text-success ring-success/35" },
};

export default function MesasEnVivoPage() {
  const live = useRestaurantLive();
  const isOwner = useIsOwner();
  const now = useNow();
  const names = tableNames(live.tables);
  const open = live.orders.filter(isOpen);

  const active = live.tables.filter((t) => t.active);
  const cards = active.map((t) => {
    const mine = open.filter((o) => o.tableId === t.id);
    const o = mine[mine.length - 1]; // el más antiguo (la lista viene de más reciente a más antiguo)
    return { table: t, state: tableState(mine), detail: o ? `${o.customerName} · ${agoLabel(minutesSince(stageSince(o), now))}` : "—" };
  });
  const areas = [...new Set(active.map((t) => t.area || "Sin área"))];
  const tasks = {
    terminal: open.filter((o) => o.status === "por_pagar" && o.cardAtTable),
    listo: open.filter((o) => o.status === "terminado"),
  };
  const occupied = cards.filter((c) => c.state !== "libre").length;

  return (
    <>
      <PageHeader title="Mesas en vivo" description={`${occupied} de ${active.length} ocupadas · ${tasks.terminal.length + tasks.listo.length} tareas · se actualiza solo`}
        actions={isOwner && (
          <Button asChild variant="outline">
            <Link href="/mesas"><Settings2 /> Agregar o editar mesas</Link>
          </Button>
        )}
      />
      <LiveGate live={live}>
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="grid content-start gap-5">
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.values(STATE).map((s) => (
                <span key={s.label} className={cn("rounded-full px-2.5 py-1 ring-1", s.box)}>{s.label}</span>
              ))}
            </div>
            {areas.map((area) => {
              const inArea = cards.filter((c) => (c.table.area || "Sin área") === area);
              return (
                <div key={area} className="grid gap-2">
                  <SectionTitle>{area} · {inArea.length} {inArea.length === 1 ? "mesa" : "mesas"}</SectionTitle>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {inArea.map(({ table, state, detail }) => (
                      <div key={table.id} className={cn("rounded-2xl p-3 ring-1", STATE[state].box)}>
                        <div className="text-lg font-semibold">{table.name}</div>
                        <div className="text-xs font-medium">{STATE[state].label}</div>
                        <div className="mt-1 truncate text-xs opacity-80">{detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {active.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Aún no hay mesas activas. El dueño las crea en Mesas y QR.</p>}
          </div>

          <div className="grid content-start gap-3">
            <SectionTitle>Tus tareas</SectionTitle>
            {tasks.terminal.length + tasks.listo.length === 0 && <Card className="p-4 text-sm text-muted-foreground">Sin tareas por ahora.</Card>}
            {tasks.terminal.map((o) => (
              <Card key={o.id} className="gap-2 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ch-web"><CreditCard className="size-4" /> Llevar terminal · {agoLabel(minutesSince(o.createdAt, now))}</div>
                <div className="font-medium">{tableLabel(names.get(o.tableId))} · {o.customerName}</div>
                <div className="text-sm text-muted-foreground">{o.folio} · cobrar {mxnCents(o.total)} con tarjeta</div>
                <Button size="sm" disabled={live.busy === o.id} onClick={() => void live.move(o.id, "pagado", "Pago cobrado: el pedido pasa a cocina")}>
                  <Check /> Pago cobrado → cocina
                </Button>
                <p className="text-xs text-muted-foreground">Si el pago no pasó, avisa a Caja para cancelar el pedido.</p>
              </Card>
            ))}
            {tasks.listo.map((o) => (
              <Card key={o.id} className="gap-2 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-success"><PackageCheck className="size-4" /> Listo para entregar · terminado {agoLabel(minutesSince(stageSince(o), now))}</div>
                <div className="font-medium">{tableLabel(names.get(o.tableId))} · {o.customerName}</div>
                <div className="text-sm text-muted-foreground">{o.folio} · {o.items.map((l) => `${l.qty}× ${l.name}`).join(", ")}</div>
                <Button size="sm" disabled={live.busy === o.id} onClick={() => void live.move(o.id, "entregado", "Pedido entregado")}>
                  Marcar entregado
                </Button>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">Cuando confirmas un pago con terminal, el pedido entra directo a la cola de cocina.</p>
          </div>
        </div>
      </LiveGate>
    </>
  );
}
