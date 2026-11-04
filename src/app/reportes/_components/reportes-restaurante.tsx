"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRestoData } from "@/app/finanzas/_components/use-resto-data";
import { PageHeader, PeriodSelect, SectionTitle, ShareBar } from "@/components/erp";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { mxn, num, pct } from "@/lib/format";
import { periodRange, PERIOD_LABEL, type Period } from "@/lib/metrics";
import { peakHours, prepTimes, salesByTable, SLOW_MINUTES, topItems } from "@/lib/metrics-restaurante";

const min = (n: number) => `${n.toFixed(1)} min`;
const span = (w: { from: number; to: number } | null) => (w ? `de ${w.from} a ${w.to} h` : null);

export function ReportesRestaurante() {
  const [period, setPeriod] = useState<Period>("mes");
  const { cur } = useMemo(() => periodRange(period), [period]);
  const { data } = useRestoData(cur.from, cur.to);

  const d = useMemo(() => {
    if (!data) return null;
    const peaks = peakHours(data.orders, cur);
    const active = peaks.byHour.flatMap((n, h) => (n ? [h] : []));
    return {
      orders: data.orders.length,
      items: topItems(data.orders, cur),
      peaks,
      hours: active.length ? peaks.byHour.slice(active[0], active[active.length - 1] + 1).map((n, i) => ({ hour: active[0] + i, n })) : [],
      prep: prepTimes(data.orders, cur, data.categoryOf),
      tables: salesByTable(data.orders, cur, data.tables),
      tableCount: data.tables.length,
    };
  }, [data, cur]);

  const header = (
    <PageHeader
      title="Reportes"
      description={`${PERIOD_LABEL[period]}${d ? ` · ${num(d.orders)} pedidos` : ""}.`}
      actions={<PeriodSelect value={period} onChange={setPeriod} options={["7d", "mes", "mes_pasado", "90d"]} />}
    />
  );
  if (!d)
    return (
      <>
        {header}
        <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
      </>
    );

  const peakMax = Math.max(1, ...d.hours.map((h) => h.n));
  const [weekday, weekend] = [span(d.peaks.weekday), span(d.peaks.weekend)];
  const prepMax = d.prep.byCategory[0]?.minutes ?? 1;
  const topArea = d.tables.areas[0];
  const none = <p className="text-sm text-muted-foreground">Sin pedidos cobrados en el periodo.</p>;

  return (
    <>
      {header}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>Más vendidos</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.items.map((i) => (
              <ShareBar key={i.name} label={i.name} value={`${num(i.qty)} · ${mxn(i.revenue)}`} share={i.qty / d.items[0].qty} color="var(--ch-tienda)" />
            ))}
            {d.items.length === 0 && none}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Horas pico · pedidos por hora</SectionTitle>
          </CardHeader>
          <CardContent>
            {d.hours.length === 0 ? (
              none
            ) : (
              <div className="flex h-44 items-end gap-1" role="img" aria-label="Pedidos por hora del día">
                {d.hours.map(({ hour, n }) => (
                  <div key={hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${hour} h · ${num(n)} pedidos`}>
                    <div className="w-full rounded-t bg-[var(--ch-tienda)]" style={{ height: `${(n / peakMax) * 100}%`, minHeight: n ? 2 : 0 }} />
                    <span className="text-[10px] text-muted-foreground tabular">{hour}</span>
                  </div>
                ))}
              </div>
            )}
            {(weekday || weekend) && (
              <p className="mt-3 text-xs text-muted-foreground">
                {[weekday && `Entre semana el pico es ${weekday}`, weekend && `sábado y domingo, ${weekend}`].filter(Boolean).join("; ")}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Tiempo de preparación</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.prep.byCategory.map((c) => (
              <ShareBar key={c.category} label={c.category} value={min(c.minutes)} share={c.minutes / prepMax} color="var(--ch-web)" />
            ))}
            {d.prep.average === null ? (
              <p className="text-sm text-muted-foreground">Aún no hay pedidos terminados en el periodo.</p>
            ) : (
              <dl className="flex flex-col gap-2 border-t pt-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Del pago a terminado (promedio)</dt>
                  <dd className="font-medium tabular">{min(d.prep.average)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Pedidos de más de {SLOW_MINUTES} min</dt>
                  <dd className="font-medium tabular">{pct(d.prep.slowShare)}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Ventas por mesa</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.tables.rows.slice(0, 10).map((t) => (
              <ShareBar
                key={t.id}
                label={t.name}
                value={mxn(t.revenue)}
                share={t.revenue / d.tables.rows[0].revenue}
                color="var(--ch-tienda)"
                sub={`${t.area ? `${t.area} · ` : ""}${num(t.orders)} pedidos`}
              />
            ))}
            {d.tables.rows.length === 0 && none}
            {topArea?.area && (
              <p className="text-xs text-muted-foreground">
                {topArea.area} vende {pct(topArea.revenue / d.tables.total, 0)} del total con {topArea.tables} de {d.tableCount} mesas.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
