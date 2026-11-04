"use client";

import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  FileText,
  Package,
  Plus,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChannelStackedBars } from "@/components/charts";
import {
  ChannelBadge,
  ChannelDot,
  change,
  KpiCard,
  PageHeader,
  PeriodSelect,
  SectionTitle,
  ShareBar,
  StatusBadge,
} from "@/components/erp";
import { RestoDashboard } from "@/components/restaurante/dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CHANNEL_COLOR, CHANNEL_LABEL } from "@/lib/constants";
import { fLongDate, fRelative, mxn, num, pct } from "@/lib/format";
import {
  byChannel,
  dailySeries,
  orderBalance,
  periodRange,
  pnl,
  productStats,
  receivables,
  type Period,
} from "@/lib/metrics";
import { useErp, useIsOwner, useWholesaleEnabled } from "@/lib/store";
import { stockOf, variantKey } from "@/lib/variants";

const DAY = 86_400_000;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

function BoutiqueDashboard() {
  const orders = useErp((s) => s.orders);
  const expenses = useErp((s) => s.expenses);
  const products = useErp((s) => s.products);
  const stock = useErp((s) => s.stock);
  const quotes = useErp((s) => s.quotes);
  const userName = useErp((s) => s.profile?.name);
  const wholesale = useWholesaleEnabled();
  const owner = useIsOwner();
  const firstName = userName?.trim().split(/\s+/)[0];
  const [period, setPeriod] = useState<Period>("mes");

  const d = useMemo(() => {
    const now = new Date();
    const { cur, prev } = periodRange(period, now);
    const p = pnl({ orders, expenses }, cur);
    const pp = pnl({ orders, expenses }, prev);
    const chartRange = period === "hoy" || period === "7d" ? { from: new Date(now.getTime() - 13 * DAY), to: now } : cur;
    const channels = byChannel(orders, cur);
    const top = [...productStats(orders, cur).entries()]
      .map(([id, s]) => ({ product: products.find((x) => x.id === id)!, ...s }))
      .filter((x) => x.product)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    // Variantes que se venden y están por agotarse
    const sold30 = new Map<string, number>();
    for (const o of orders) {
      if (o.status === "cancelado" || now.getTime() - new Date(o.date).getTime() > 30 * DAY) continue;
      for (const it of o.items) sold30.set(it.variantKey, (sold30.get(it.variantKey) ?? 0) + it.qty);
    }
    const lowStock = products
      .flatMap((pr) =>
        pr.colors.flatMap((c) =>
          pr.sizes.map((size) => {
            const key = variantKey(pr.id, c.name, size);
            return { product: pr, color: c.name, size, onHand: stockOf(stock, key), sold: sold30.get(key) ?? 0 };
          }),
        ),
      )
      .filter((v) => v.sold >= 2 && v.onHand <= v.product.minStock)
      .sort((a, b) => a.onHand - b.onHand || b.sold - a.sold);

    const toAttend = orders
      .filter((o) => o.status === "pendiente" || o.status === "pagado" || o.status === "apartado")
      .sort((a, b) => b.date.localeCompare(a.date));
    const ar = receivables(orders).reduce((a, o) => a + orderBalance(o), 0);
    const openQuotes = quotes.filter((q) => q.status === "enviada" || q.status === "borrador");

    return { p, pp, daily: dailySeries(orders, chartRange), channels, top, lowStock, toAttend, ar, openQuotes };
  }, [period, orders, expenses, products, stock, quotes]);

  const totalChannel = d.channels.reduce((a, c) => a + c.revenue, 0);

  return (
    <>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description={<span className="inline-block first-letter:uppercase">{fLongDate(new Date().toISOString())} · así va tu negocio</span>}
        actions={
          <>
            <PeriodSelect value={period} onChange={setPeriod} />
            {wholesale && (
              <Button asChild variant="outline" className="h-9">
                <Link href="/mayoreo/nueva">
                  <FileText /> Cotización
                </Link>
              </Button>
            )}
            <Button asChild className="h-9">
              <Link href="/pedidos/nuevo">
                <Plus /> Nuevo pedido
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Ventas" value={mxn(d.p.revenue)} delta={change(d.p.revenue, d.pp.revenue)} icon={TrendingUp} accent />
        {owner ? (
          <>
            <KpiCard
              label="Utilidad bruta"
              value={mxn(d.p.grossProfit)}
              delta={change(d.p.grossProfit, d.pp.grossProfit)}
              deltaLabel=""
              hint={<span>· margen {pct(d.p.grossMargin)}</span>}
              icon={Banknote}
            />
            <KpiCard
              label="Utilidad operativa"
              value={mxn(d.p.operatingProfit)}
              hint={<span>margen operativo <b className="text-foreground">{pct(d.p.operatingMargin)}</b></span>}
              icon={Wallet}
            />
          </>
        ) : (
          <>
            <KpiCard label="Piezas vendidas" value={num(d.p.units)} delta={change(d.p.units, d.pp.units)} icon={Package} />
            <KpiCard label="Por cobrar" value={mxn(d.ar)} hint="saldos de pedidos y apartados" icon={Wallet} />
          </>
        )}
        <KpiCard
          label="Pedidos"
          value={num(d.p.orders)}
          delta={change(d.p.orders, d.pp.orders)}
          deltaLabel=""
          hint={<span>· ticket {mxn(d.p.avgTicket)}</span>}
          icon={ShoppingBag}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <SectionTitle>Ventas diarias por canal</SectionTitle>
          </CardHeader>
          <CardContent>
            <ChannelStackedBars data={d.daily} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle action={owner && <Link href="/reportes" className="text-xs text-muted-foreground hover:text-foreground">Ver reporte</Link>}>
              ¿Por dónde te compran?
            </SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {[...d.channels]
              .sort((a, b) => b.revenue - a.revenue)
              .map((c) => (
                <ShareBar
                  key={c.channel}
                  label={<><ChannelDot channel={c.channel} />{CHANNEL_LABEL[c.channel]}</>}
                  value={mxn(c.revenue)}
                  share={totalChannel ? c.revenue / totalChannel : 0}
                  color={CHANNEL_COLOR[c.channel]}
                  sub={
                    <>
                      {pct(totalChannel ? c.revenue / totalChannel : 0, 0)} · {num(c.orders)} pedidos
                      {owner && <> · margen bruto {pct(c.margin, 0)}</>}
                    </>
                  }
                />
              ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <SectionTitle action={<Link href="/pedidos" className="text-xs text-muted-foreground hover:text-foreground">Ver todos</Link>}>
              Pedidos por atender <span className="ml-1 text-muted-foreground">({d.toAttend.length})</span>
            </SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {d.toAttend.slice(0, 6).map((o) => (
              <Link key={o.id} href={`/pedidos/${o.id}`} className="flex items-center gap-3 py-2.5 first:pt-0 hover:opacity-80">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{o.folio}</span>
                    <span className="truncate text-muted-foreground">{o.customerName}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <ChannelBadge channel={o.channel} /> · {fRelative(o.date)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular">{mxn(o.total)}</span>
                  <StatusBadge status={o.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle action={<Link href="/inventario?tab=reabasto" className="text-xs text-muted-foreground hover:text-foreground">Reabastecer</Link>}>
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-warning" /> Tallas por agotarse
              </span>
            </SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {d.lowStock.slice(0, 6).map((v) => (
              <div key={`${v.product.id}${v.color}${v.size}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{v.product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.color} · Talla {v.size} · vendió {v.sold} en 30 días
                  </div>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular ${v.onHand === 0 ? "bg-destructive/12 text-destructive" : "bg-warning/15 text-warning"}`}>
                  {v.onHand === 0 ? "Agotado" : `Quedan ${v.onHand}`}
                </span>
              </div>
            ))}
            {d.lowStock.length > 6 && (
              <p className="pt-2.5 text-xs text-muted-foreground">+{d.lowStock.length - 6} variantes más con stock bajo</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader>
            <SectionTitle action={wholesale && <Link href="/mayoreo" className="text-xs text-muted-foreground hover:text-foreground">Mayoreo</Link>}>
              Dinero en camino
            </SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className={`grid gap-3 ${wholesale ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="rounded-lg bg-muted/60 p-3">
                <div className="text-xs text-muted-foreground">Saldos por cobrar</div>
                <div className="mt-1 text-lg font-semibold tabular">{mxn(d.ar)}</div>
              </div>
              {wholesale && (
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="text-xs text-muted-foreground">Cotizaciones abiertas</div>
                  <div className="mt-1 text-lg font-semibold tabular">{mxn(d.openQuotes.reduce((a, q) => a + q.total, 0))}</div>
                </div>
              )}
            </div>
            <div className="flex flex-col divide-y">
              {(wholesale ? d.openQuotes : []).slice(0, 4).map((q) => (
                <Link key={q.id} href={`/mayoreo/${q.id}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 hover:opacity-80">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{q.customerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {q.folio} · {q.items.reduce((a, it) => a + it.qty, 0)} pzs · vence {fRelative(q.validUntil)}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-medium tabular">
                    {mxn(q.total)} <ArrowRight className="size-3.5 text-muted-foreground" />
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <SectionTitle action={<Receipt className="size-4 text-muted-foreground" />}>Lo más vendido en el periodo</SectionTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Producto</th>
                <th className="pb-2 text-right font-medium">Piezas</th>
                <th className="pb-2 text-right font-medium">Venta</th>
                {owner && <th className="pb-2 text-right font-medium">Utilidad bruta</th>}
                {owner && <th className="pb-2 text-right font-medium">Margen</th>}
              </tr>
            </thead>
            <tbody>
              {d.top.map((t) => (
                <tr key={t.product.id} className="border-b last:border-0">
                  <td className="py-2.5">
                    <div className="font-medium">{t.product.name}</div>
                    <div className="text-xs text-muted-foreground">{t.product.category}</div>
                  </td>
                  <td className="py-2.5 text-right tabular">{num(t.units)}</td>
                  <td className="py-2.5 text-right tabular">{mxn(t.revenue)}</td>
                  {owner && <td className="py-2.5 text-right tabular">{mxn(t.revenue - t.cogs)}</td>}
                  {owner && <td className="py-2.5 text-right tabular">{pct((t.revenue - t.cogs) / t.revenue)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

/** Cada giro tiene su panel; la boutique conserva el suyo sin cambios. */
export default function Dashboard() {
  const kind = useErp((s) => s.kind);
  return kind === "restaurante" ? <RestoDashboard /> : <BoutiqueDashboard />;
}
