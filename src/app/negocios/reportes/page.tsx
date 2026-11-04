"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { change, Delta, PageHeader, PeriodSelect } from "@/components/erp";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYMENT_LABEL } from "@/lib/constants";
import { mxn, num, pct } from "@/lib/format";
import { periodRange, type Period } from "@/lib/metrics";
import { peakLabel, sumBy, type Overview, type Totals } from "@/lib/owner";
import type { PaymentMethod } from "@/lib/types";
import { useOverview } from "../_components/use-overview";

const PERIODS: Period[] = ["7d", "mes", "mes_pasado", "90d"];

/** Campos de `owner_overview` que `Overview` (src/lib/owner.ts) aún no declara. */
type Detail = Omit<Overview, "paymentMethods"> & {
  paymentMethods: { businessId: string; method: string; atTable: boolean | null; amount: number }[];
  topItems: { businessId: string; name: string; qty: number }[];
};

export default function NegociosReportesPage() {
  const [period, setPeriod] = useState<Period>("mes");
  const range = useMemo(() => periodRange(period).cur, [period]);
  const o = useOverview(range.from, range.to) as Detail | null;

  const ticket = (revenue: number, orders: number) => (orders ? mxn(revenue / orders) : "—");
  const margin = (profit: number, revenue: number) => (revenue ? pct(profit / revenue) : "—");
  const rows: [string, (t: Totals) => string][] = [
    ["Ventas", (t) => mxn(t.revenue)],
    ["Pedidos", (t) => num(t.orders)],
    ["Ticket promedio", (t) => ticket(t.revenue, t.orders)],
    ["Margen operativo", (t) => margin(t.profit, t.revenue)],
  ];
  const methods = o ? sumBy(o.paymentMethods, "method", null).map((m) => m.key) : [];
  const share = (id: string, method: string) => {
    const mine = o?.paymentMethods.filter((p) => p.businessId === id) ?? [];
    const all = mine.reduce((a, p) => a + p.amount, 0);
    return all ? pct(mine.filter((p) => p.method === method).reduce((a, p) => a + p.amount, 0) / all, 0) : "—";
  };

  // Tarjeta de restaurante: cuánto se cobra con la terminal en la mesa y cuánto en caja.
  const atTable = (id: string) => {
    const card = o?.paymentMethods.filter((p) => p.businessId === id && p.method === "tarjeta" && p.atTable !== null) ?? [];
    const all = card.reduce((a, p) => a + p.amount, 0);
    return all ? card.filter((p) => p.atTable).reduce((a, p) => a + p.amount, 0) / all : null;
  };

  return (
    <>
      <PageHeader title="Reportes" description="Compara tus negocios lado a lado." actions={<PeriodSelect value={period} onChange={setPeriod} options={PERIODS} />} />
      {!o ? (
        <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-4">
          <Card className="gap-3 px-0">
            <h2 className="px-4 font-semibold">Indicadores clave</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Indicador</TableHead>
                  {o.businesses.map((b) => (
                    <TableHead key={b.id} className="text-right">
                      {b.name}
                    </TableHead>
                  ))}
                  <TableHead className="pr-4 text-right">Todos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(([label, f]) => (
                  <TableRow key={label}>
                    <TableCell className="pl-4 font-medium">{label}</TableCell>
                    {o.businesses.map((b) => (
                      <TableCell key={b.id} className="text-right tabular">
                        {f(b)}
                      </TableCell>
                    ))}
                    <TableCell className="pr-4 text-right tabular">{f(o.totals)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="pl-4 font-medium">Crecimiento vs. periodo anterior</TableCell>
                  {o.businesses.map((b) => (
                    <TableCell key={b.id} className="text-right">
                      <Delta value={change(b.revenue, b.prevRevenue)} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-4 text-right">
                    <Delta value={change(o.totals.revenue, o.previous.revenue)} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-4 font-medium">Hora pico</TableCell>
                  {o.businesses.map((b) => (
                    <TableCell key={b.id} className="text-right tabular">
                      {peakLabel(b.peakHour)}
                    </TableCell>
                  ))}
                  <TableCell className="pr-4 text-right">—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          <Card className="gap-3 px-0">
            <h2 className="px-4 font-semibold">Métodos de pago</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Negocio</TableHead>
                  {methods.map((m) => (
                    <TableHead key={m} className="text-right">
                      {PAYMENT_LABEL[m as PaymentMethod] ?? m}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.businesses.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="pl-4 font-medium">{b.name}</TableCell>
                    {methods.map((m) => (
                      <TableCell key={m} className="text-right tabular">
                        {share(b.id, m)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {methods.length === 0 && (
                  <TableRow>
                    <TableCell className="pl-4 text-muted-foreground">Sin pagos en el periodo.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {o.businesses.map((b) => {
              const share = atTable(b.id);
              return (
                share !== null && (
                  <p key={b.id} className="px-4 text-xs text-muted-foreground">
                    En {b.name}, {pct(share, 0)} de los pagos con tarjeta se cobran con la terminal en la mesa.
                  </p>
                )
              );
            })}
          </Card>
          <Card className="gap-3 px-4">
            <h2 className="font-semibold">Lo más vendido</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {o.businesses.map((b) => {
                const top = o.topItems.filter((i) => i.businessId === b.id);
                return (
                  <div key={b.id} className="grid content-start gap-1.5">
                    <h3 className="text-sm font-medium">{b.name}</h3>
                    {top.map((i) => (
                      <div key={i.name} className="flex justify-between gap-3 text-sm">
                        <span className="truncate">{i.name}</span>
                        <span className="tabular text-muted-foreground">{num(i.qty)}</span>
                      </div>
                    ))}
                    {top.length === 0 && <p className="text-sm text-muted-foreground">Sin ventas en el periodo.</p>}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
