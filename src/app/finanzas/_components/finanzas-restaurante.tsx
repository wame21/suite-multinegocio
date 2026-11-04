"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Banknote, Loader2, Receipt, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { change, KpiCard, PageHeader, PeriodSelect, SectionTitle, ShareBar } from "@/components/erp";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_LABEL } from "@/lib/constants";
import { mxn, pct } from "@/lib/format";
import { periodRange, PERIOD_LABEL, type Period } from "@/lib/metrics";
import { dailyCut, restoPnl, revenueByChannel, type PayChannel } from "@/lib/metrics-restaurante";
import type { ExpenseCategory } from "@/lib/types";
import { ExpenseDialog } from "./expense-dialog";
import { useRestoData } from "./use-resto-data";

const CHANNEL_LABEL: Record<PayChannel, string> = {
  efectivo: "Efectivo",
  tarjeta_mesa: "Tarjeta · terminal en la mesa",
  tarjeta_caja: "Tarjeta · en caja",
  transferencia: "Transferencia",
};
const CUT_DAYS = 14;

export function FinanzasRestaurante() {
  const [period, setPeriod] = useState<Period>("mes");
  const { cur, prev } = useMemo(() => periodRange(period), [period]);
  const { data, reload } = useRestoData(prev.from, cur.to);

  const d = useMemo(() => {
    if (!data) return null;
    const channels = revenueByChannel(data.orders, cur);
    return {
      p: restoPnl(data.orders, data.expenses, data.fees, cur),
      pp: restoPnl(data.orders, data.expenses, data.fees, prev),
      channels,
      channelTotal: channels.reduce((a, c) => a + c.amount, 0),
      card: channels.filter((c) => c.channel.startsWith("tarjeta")).reduce((a, c) => a + c.amount, 0),
      cuts: dailyCut(data.orders, cur),
    };
  }, [data, cur, prev]);

  const header = (
    <PageHeader
      title="Finanzas"
      description={`${PERIOD_LABEL[period]} · lo que entra por cada método y lo que cuesta operar.`}
      actions={
        <>
          <PeriodSelect value={period} onChange={setPeriod} options={["7d", "mes", "mes_pasado", "90d"]} />
          <ExpenseDialog onAdded={reload} />
        </>
      }
    />
  );
  if (!d)
    return (
      <>
        {header}
        <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
      </>
    );

  const { p, pp } = d;
  const spent = p.opex + p.fees;
  const categories = (Object.keys(p.byCat) as ExpenseCategory[]).map((c) => ({ c, v: p.byCat[c] ?? 0 })).sort((a, b) => b.v - a.v);
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Ventas" value={mxn(p.revenue)} delta={change(p.revenue, pp.revenue)} icon={TrendingUp} />
        <KpiCard label="Costo de insumos" value={mxn(p.cogs)} hint={`${pct(p.revenue ? p.cogs / p.revenue : 0)} de las ventas`} icon={Receipt} />
        <KpiCard label="Gastos de operación" value={mxn(spent)} delta={change(spent, pp.opex + pp.fees)} invertDelta icon={Banknote} />
        <KpiCard
          label="Utilidad operativa"
          value={mxn(p.operatingProfit)}
          hint={<span>margen <b className="text-foreground">{pct(p.operatingMargin)}</b></span>}
          icon={Wallet}
          accent
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionTitle>Ingresos por método de pago</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.channels.map(({ channel, amount }) => (
              <ShareBar
                key={channel}
                label={CHANNEL_LABEL[channel]}
                value={`${mxn(amount)} · ${pct(amount / d.channelTotal, 0)}`}
                share={amount / d.channelTotal}
                color="var(--ch-web)"
              />
            ))}
            {d.channels.length === 0 && <p className="text-sm text-muted-foreground">Sin cobros en el periodo.</p>}
            {p.fees > 0 && (
              <p className="text-xs text-muted-foreground">
                Comisiones de terminal estimadas: {mxn(p.fees)}
                {d.card > 0 && ` (${pct(p.fees / d.card)} de lo cobrado con tarjeta)`}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Gastos del periodo</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {categories.map(({ c, v }) => (
              <ShareBar key={c} label={EXPENSE_LABEL[c]} value={mxn(v)} share={v / spent} color="var(--ch-tienda)" />
            ))}
            {p.fees > 0 && <ShareBar label="Comisiones de terminal" value={mxn(p.fees)} share={p.fees / spent} color="var(--ch-tienda)" />}
            {spent === 0 ? (
              <p className="text-sm text-muted-foreground">Sin gastos en el periodo. Usa «Registrar gasto» para sumarlos a la utilidad.</p>
            ) : (
              <div className="flex justify-between border-t pt-3 text-sm font-medium">
                <span>Total</span>
                <span className="tabular">{mxn(spent)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 gap-3 px-0">
        <h2 className="px-4 text-sm font-semibold">Corte de caja diario</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Día</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">Efectivo</TableHead>
              <TableHead className="text-right">Tarjeta</TableHead>
              <TableHead className="text-right">Transferencia</TableHead>
              <TableHead className="pr-4 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.cuts.slice(0, CUT_DAYS).map((r) => (
              <TableRow key={r.day}>
                <TableCell className="pl-4 font-medium">
                  {format(new Date(`${r.day}T12:00:00`), "EEE d MMM", { locale: es })}
                  {r.day === today && <span className="ml-1 text-xs font-normal text-muted-foreground">(abierto)</span>}
                </TableCell>
                <TableCell className="text-right tabular">{r.orders}</TableCell>
                <TableCell className="text-right tabular">{mxn(r.efectivo)}</TableCell>
                <TableCell className="text-right tabular">{mxn(r.tarjeta)}</TableCell>
                <TableCell className="text-right tabular">{mxn(r.transferencia)}</TableCell>
                <TableCell className="pr-4 text-right font-medium tabular">{mxn(r.total)}</TableCell>
              </TableRow>
            ))}
            {d.cuts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="pl-4 text-muted-foreground">
                  Sin cobros en el periodo.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {d.cuts.length > CUT_DAYS && <p className="px-4 text-xs text-muted-foreground">Se muestran los últimos {CUT_DAYS} días con cobros.</p>}
      </Card>
    </>
  );
}
