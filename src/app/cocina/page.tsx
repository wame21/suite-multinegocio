"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/erp";
import { useNow, useRestaurantLive } from "@/components/restaurante/live";
import { dayStats, groupByStatus, minutesSince, stageSince } from "@/components/restaurante/orders";
import { LiveGate, OrderLines, tableLabel, tableNames } from "@/components/restaurante/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TableOrder, TableOrderStatus } from "@/lib/restaurant";
import { cn } from "@/lib/utils";

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => void ctx.close(), 400);
  } catch {
    // sin audio disponible: el aviso visual basta
  }
}

export default function CocinaPage() {
  const live = useRestaurantLive();
  const now = useNow(15_000);
  const names = tableNames(live.tables);
  const g = groupByStatus(live.orders);
  const avg = dayStats(live.orders, live.tables, new Date(now)).prepAvg;

  // Apagado al abrir: el clic que lo enciende también desbloquea el audio del navegador.
  const [sound, setSound] = useState(false);
  const toggleSound = () => {
    setSound(!sound);
    if (!sound) beep();
  };

  // Suena cuando entra un pedido pagado que no estaba en la pantalla.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!live.loaded) return;
    const ids = live.orders.filter((o) => o.status === "pagado").map((o) => o.id);
    if (sound && seen.current && ids.some((id) => !seen.current!.has(id))) beep();
    seen.current = new Set(ids);
  }, [live.loaded, live.orders, sound]);

  const columns: { status: TableOrderStatus; title: string; sub: string; next?: [TableOrderStatus, string] }[] = [
    { status: "pagado", title: "Nuevos", sub: "pagados", next: ["en_preparacion", "Empezar a preparar"] },
    { status: "en_preparacion", title: "En preparación", sub: "", next: ["terminado", "Terminado"] },
    { status: "terminado", title: "Terminados", sub: "por entregar" },
  ];

  const card = (o: TableOrder, next?: [TableOrderStatus, string]) => {
    const mins = minutesSince(stageSince(o), now);
    return (
      <Card key={o.id} className={cn("gap-3 p-4", o.status === "en_preparacion" && mins >= 10 && "ring-warning/50")}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xl font-semibold">{tableLabel(names.get(o.tableId))}</div>
            <div className="text-xs text-muted-foreground">{o.folio} · {o.customerName}</div>
          </div>
          <span className="text-sm tabular text-muted-foreground">{mins < 1 ? "recién" : `${mins} min`}</span>
        </div>
        <OrderLines order={o} large />
        {next ? (
          <Button size="lg" disabled={live.busy === o.id} onClick={() => void live.move(o.id, next[0])}>{next[1]}</Button>
        ) : (
          <p className="text-xs text-muted-foreground">El mesero ya fue avisado.</p>
        )}
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        title="Cocina"
        description={`Promedio hoy ${avg === null ? "—" : `${avg.toFixed(1)} min`} · el comensal ve cada cambio en su celular`}
        actions={
          <Button variant="outline" onClick={toggleSound} aria-pressed={sound}>
            {sound ? <Volume2 /> : <VolumeX />} Sonido {sound ? "activado" : "apagado"}
          </Button>
        }
      />
      <LiveGate live={live}>
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map((c) => (
            <section key={c.status} className="grid content-start gap-3">
              <h2 className="flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide">
                {c.title}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular">{g[c.status].length}</span>
                {c.sub && <span className="text-xs font-normal normal-case text-muted-foreground">{c.sub}</span>}
              </h2>
              {g[c.status].length === 0 && <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground">Sin pedidos</p>}
              {g[c.status].map((o) => card(o, c.next))}
            </section>
          ))}
        </div>
      </LiveGate>
    </>
  );
}
