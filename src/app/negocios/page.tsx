"use client";

import { Loader2, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { EmptyState, KpiCard, PageHeader, change } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KIND_LABEL, PAYMENT_LABEL } from "@/lib/constants";
import { fDay, mxn, pct } from "@/lib/format";
import { periodRange } from "@/lib/metrics";
import { canEnter, lastMonthsRange, monthlyRows, sumBy } from "@/lib/owner";
import type { PaymentMethod } from "@/lib/types";
import { initialsOf, useOwner } from "./_components/owner-shell";
import { StateBadge } from "./_components/state-badge";
import { useOverview } from "./_components/use-overview";

const COLORS = ["var(--ch-tienda)", "var(--ch-web)", "var(--ch-whatsapp)", "var(--ch-instagram)", "var(--ch-mayoreo)"];

const greeting = (h: number) => (h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches");

export default function NegociosPage() {
  const { name, businesses, enter, entering } = useOwner();
  const month = useMemo(() => periodRange("mes").cur, []);
  const six = useMemo(() => lastMonthsRange(6), []);
  const overview = useOverview(month.from, month.to);
  const history = useOverview(six.from, six.to);

  if (!businesses) return <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />;
  const first = name.split(" ")[0];

  if (businesses.length === 0)
    return (
      <>
        <PageHeader title={`Hola, ${first}`} description="Tu cuenta está lista. Agrega tu primer negocio para empezar." />
        <Card className="items-center gap-4 px-8 py-12 text-center">
          <EmptyState icon={Store} title="Aún no tienes negocios">
            Una boutique, una cafetería o un restaurante. Cada negocio tiene su propio panel, equipo y membresía; aquí verás las finanzas de todos
            juntos.
          </EmptyState>
          <Button asChild size="lg">
            <Link href="/negocios/nuevo">
              <Plus /> Crear mi primer negocio
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">Lo revisamos antes de activarlo; te avisamos en esta misma pantalla.</p>
        </Card>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ["Ventas del mes", "Aparecen al activar tu primer negocio"],
            ["Gastos del mes", "Suma de todos tus negocios"],
            ["Utilidad", "Ventas menos costos y gastos"],
          ].map(([label, hint]) => (
            <KpiCard key={label} label={label} value="—" hint={hint} />
          ))}
        </div>
      </>
    );

  const active = businesses.filter((b) => b.state === "prueba" || b.state === "activa" || b.state === "gracia").length;
  const inReview = businesses.filter((b) => b.state === "revision").length;
  const rejected = businesses.filter((b) => b.state === "rechazada").length;
  const t = overview?.totals;
  const spent = t ? t.expenses + t.fees : 0;
  const months = history ? monthlyRows(history.byMonth, 6, null) : [];
  const chartBiz = history?.businesses.filter((b) => history.byMonth.some((r) => r.businessId === b.id)) ?? [];
  const max = Math.max(1, ...months.map((m) => m.ingresos));
  const topMethod = overview ? sumBy(overview.paymentMethods, "method", null)[0] : undefined;
  const methodsTotal = overview?.paymentMethods.reduce((a, r) => a + r.amount, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={`${greeting(new Date().getHours())}, ${first}`}
        description={`Así van tus ${businesses.length} ${businesses.length === 1 ? "negocio" : "negocios"} este mes.`}
        actions={
          <Button asChild>
            <Link href="/negocios/nuevo">
              <Plus /> Nuevo negocio
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ventas · todos los negocios" value={t ? mxn(t.revenue) : "—"} delta={t && overview ? change(t.revenue, overview.previous.revenue) : undefined} deltaLabel="vs. mes anterior" />
        <KpiCard label="Gastos" value={t ? mxn(spent) : "—"} hint="Renta, nómina e insumos" />
        <KpiCard label="Utilidad operativa" value={t ? mxn(t.profit) : "—"} hint={t && t.revenue ? `margen ${pct(t.profit / t.revenue)}` : undefined} />
        <KpiCard
          label="Negocios activos"
          value={
            <>
              {active} <span className="text-lg text-muted-foreground">de {businesses.length}</span>
            </>
          }
          hint={[inReview && `${inReview} en revisión`, rejected && `${rejected} ${rejected === 1 ? "rechazado" : "rechazados"}`].filter(Boolean).join(" · ") || undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="gap-4 px-4">
          <h2 className="font-semibold">Ventas por negocio · últimos 6 meses</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {chartBiz.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: COLORS[history!.businesses.indexOf(b) % COLORS.length] }} />
                {b.name}
              </span>
            ))}
          </div>
          <div role="img" aria-label="Ventas mensuales apiladas por negocio" className="flex h-44 items-end gap-3">
            {months.map((m) => (
              <div key={m.key} className="flex h-full flex-1 flex-col justify-end" title={`${m.month}: ${mxn(m.ingresos)}`}>
                <div className="flex flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${(m.ingresos / max) * 100}%` }}>
                  {chartBiz.map((b) => {
                    const v = history!.byMonth.find((r) => r.businessId === b.id && r.month === m.key)?.revenue ?? 0;
                    return <span key={b.id} style={{ flexGrow: v, background: COLORS[history!.businesses.indexOf(b) % COLORS.length] }} />;
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {months.map((m) => (
              <span key={m.key} className="flex-1 text-center">
                {m.month}
              </span>
            ))}
          </div>
        </Card>
        <Card className="gap-4 px-4">
          <h2 className="font-semibold">Participación del mes</h2>
          {overview?.businesses.map((b, i) => (
            <div key={b.id} className="grid gap-1.5">
              <div className="flex justify-between text-sm">
                <span>{b.name}</span>
                <strong className="tabular">
                  {mxn(b.revenue)} · {pct(t?.revenue ? b.revenue / t.revenue : 0, 0)}
                </strong>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: pct(t?.revenue ? b.revenue / t.revenue : 0, 0), background: COLORS[i % COLORS.length] }} />
              </div>
            </div>
          ))}
          <div className="mt-auto grid gap-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mejor día</span>
              <span>{overview?.bestDay ? `${fDay(overview.bestDay.day + "T12:00:00")} · ${mxn(overview.bestDay.revenue)}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Método más usado</span>
              <span>
                {topMethod ? `${PAYMENT_LABEL[topMethod.key as PaymentMethod] ?? topMethod.key} · ${pct(topMethod.amount / methodsTotal, 0)}` : "—"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-8 mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold">Mis negocios</h2>
        <span className="text-sm text-muted-foreground">Entra a uno para ver su panel</span>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(15.5rem,1fr))]">
        {businesses.map((b) => (
          <Card key={b.id} className="gap-4 px-4">
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-full bg-gold/15 text-xs font-bold text-gold ring-1 ring-gold/35">{initialsOf(b.name)}</span>
              <StateBadge state={b.state} endsAt={b.endsAt} />
            </div>
            <div>
              <h3 className="font-semibold">{b.name}</h3>
              <p className="text-sm text-muted-foreground">{KIND_LABEL[b.kind]}</p>
            </div>
            {b.state === "rechazada" ? (
              <p className="text-sm text-destructive">Motivo: {b.rejectionReason ?? "sin motivo registrado"}.</p>
            ) : b.state === "revision" ? (
              <p className="text-sm text-muted-foreground">Estamos revisando tu solicitud. Ten paciencia: te avisamos aquí en cuanto se active.</p>
            ) : (
              <div>
                <div className="text-2xl font-semibold tabular">{mxn(b.monthSales ?? 0)}</div>
                <div className="text-xs text-muted-foreground">ventas este mes</div>
              </div>
            )}
            {b.state === "rechazada" ? (
              <Button asChild variant="outline" className="mt-auto">
                <Link href="/negocios/membresias">Ver detalle</Link>
              </Button>
            ) : (
              <Button variant="outline" className="mt-auto" disabled={!canEnter(b) || entering !== null} onClick={() => void enter(b)}>
                {entering === b.id && <Loader2 className="animate-spin" />}
                {b.state === "revision" ? "En revisión" : "Entrar"}
              </Button>
            )}
          </Card>
        ))}
        <Link
          href="/negocios/nuevo"
          className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed text-center text-sm text-muted-foreground transition-colors hover:border-gold/60 hover:text-foreground"
        >
          <Plus className="size-6 text-gold" />
          <strong className="text-foreground">Nuevo negocio</strong>
          Boutique, cafetería o restaurante
        </Link>
      </div>
    </>
  );
}
