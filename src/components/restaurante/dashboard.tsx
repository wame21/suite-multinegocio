"use client";

import { ChefHat, ClipboardList, Receipt, Timer, Utensils } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { KpiCard, PageHeader, SectionTitle, ShareBar } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mxn, mxnCents, num } from "@/lib/format";
import { useBusinessName, useErp } from "@/lib/store";
import { startOfToday, useNow, useRestaurantLive } from "./live";
import { dayStats, minutesSince } from "./orders";
import { LiveGate } from "./ui";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

/** Panel general del restaurante: lo de hoy en vivo. */
export function RestoDashboard() {
  const live = useRestaurantLive(startOfToday());
  const now = useNow();
  const name = useErp((s) => s.profile?.name)?.trim().split(/\s+/)[0];
  const business = useBusinessName();
  const s = useMemo(() => dayStats(live.orders, live.tables, new Date(now)), [live.orders, live.tables, now]);

  const hours = Object.keys(s.byHour).map(Number);
  const [h0, h1] = hours.length ? [Math.min(...hours), Math.max(...hours)] : [0, -1];
  const peak = Math.max(1, ...Object.values(s.byHour));
  const top = s.top[0]?.[1] ?? 1;

  const tiles = [
    { label: "Por cobrar", n: s.counts.por_pagar, hint: "Caja confirma el pago" },
    { label: "Pagados, en cola", n: s.counts.pagado, hint: "Esperan a cocina" },
    { label: "En preparación", n: s.counts.en_preparacion, hint: s.oldestPrep ? `El más antiguo: ${minutesSince(s.oldestPrep, now)} min` : "Cocina al día" },
    { label: "Terminados", n: s.counts.terminado, hint: "Por entregar en mesa" },
    { label: "Entregados hoy", n: s.counts.entregado, hint: `${s.counts.cancelado} cancelados` },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}${name ? `, ${name}` : ""}`}
        description={`${business} · así va el día`}
        actions={
          <Button asChild variant="outline">
            <Link href="/cocina">
              <ChefHat /> Abrir Cocina
            </Link>
          </Button>
        }
      />
      <LiveGate live={live}>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard accent label="Ventas de hoy" value={mxn(s.sales)} icon={Receipt} hint="pagos confirmados" />
            <KpiCard label="Pedidos cobrados" value={num(s.paidCount)} icon={ClipboardList} hint={`ticket promedio ${mxnCents(s.ticket)}`} />
            <KpiCard label="Mesas ocupadas" value={`${s.occupied} de ${s.activeTables}`} icon={Utensils} />
            <KpiCard label="Tiempo de preparación" value={s.prepAvg === null ? "—" : `${s.prepAvg.toFixed(1)} min`} icon={Timer} hint="promedio de hoy" />
          </div>

          <Card className="gap-3 p-4">
            <SectionTitle>Pedidos en curso · en tiempo real</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {tiles.map((t) => (
                <div key={t.label} className="rounded-xl bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">{t.label}</div>
                  <div className="text-2xl font-semibold tabular">{t.n}</div>
                  <div className="text-xs text-muted-foreground">{t.hint}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card className="gap-3 p-4">
              <SectionTitle>Ventas por hora hoy</SectionTitle>
              {hours.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay ventas hoy.</p>
              ) : (
                <div className="flex h-40 items-end gap-2">
                  {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).map((h) => (
                    <div key={h} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={mxn(s.byHour[h] ?? 0)}>
                      <div className="w-full rounded-t-md bg-gold" style={{ height: `${((s.byHour[h] ?? 0) / peak) * 100}%` }} />
                      <span className="text-[11px] text-muted-foreground tabular">{h} h</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="gap-3 p-4">
              <SectionTitle>Lo más pedido hoy</SectionTitle>
              {s.top.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay pedidos cobrados.</p>
              ) : (
                s.top.map(([item, qty]) => <ShareBar key={item} label={item} value={qty} share={qty / top} color="var(--gold)" />)
              )}
            </Card>
          </div>
        </div>
      </LiveGate>
    </>
  );
}
