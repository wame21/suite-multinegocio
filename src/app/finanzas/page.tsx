"use client";

import { Banknote, Receipt, Scale, Trash2, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FinanceBars } from "@/components/charts";
import { change, Delta, KpiCard, PageHeader, PeriodSelect, SectionTitle, ShareBar } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_LABEL, PAYMENT_LABEL } from "@/lib/constants";
import { fDate, fRelative, mxn, pct } from "@/lib/format";
import {
  breakEven,
  expensesIn,
  inRange,
  monthlySeries,
  orderBalance,
  periodRange,
  PERIOD_LABEL,
  pnl,
  receivables,
  type Period,
} from "@/lib/metrics";
import { errorMessage, useBranchName, useErp } from "@/lib/store";
import type { ExpenseCategory, PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExpenseDialog } from "./_components/expense-dialog";
import { FinanzasRestaurante } from "./_components/finanzas-restaurante";

function FinanzasBoutique() {
  const orders = useErp((s) => s.orders);
  const expenses = useErp((s) => s.expenses);
  const removeExpense = useErp((s) => s.removeExpense);
  const branchName = useBranchName();
  const [period, setPeriod] = useState<Period>("mes");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const d = useMemo(() => {
    const { cur, prev } = periodRange(period);
    const cash = new Map<PaymentMethod, number>();
    for (const o of orders) for (const pay of o.payments) if (inRange(pay.date, cur)) cash.set(pay.method, (cash.get(pay.method) ?? 0) + pay.amount);
    return {
      p: pnl({ orders, expenses }, cur),
      pp: pnl({ orders, expenses }, prev),
      list: expensesIn(expenses, cur).sort((a, b) => b.date.localeCompare(a.date)),
      months: monthlySeries({ orders, expenses }, 4),
      be: breakEven({ orders, expenses }),
      monthRevenue: pnl({ orders, expenses }, periodRange("mes").cur).revenue,
      ar: receivables(orders).sort((a, b) => orderBalance(b) - orderBalance(a)),
      cash: [...cash.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [period, orders, expenses]);

  const { p, pp } = d;
  const cats = (Object.keys(EXPENSE_LABEL) as ExpenseCategory[])
    .map((c) => ({ c, v: p.byCat[c] ?? 0, prev: pp.byCat[c] ?? 0 }))
    .filter((x) => x.v > 0 || x.prev > 0)
    .sort((a, b) => b.v - a.v);
  const cashTotal = d.cash.reduce((a, [, v]) => a + v, 0);
  const arTotal = d.ar.reduce((a, o) => a + orderBalance(o), 0);
  const beProgress = d.be.breakEven ? d.monthRevenue / d.be.breakEven : 0;

  const lines: { label: string; cur: number; prev: number; kind?: "sub" | "total" | "neg"; indent?: boolean }[] = [
    { label: "Ventas brutas", cur: p.gross, prev: pp.gross },
    { label: "Descuentos", cur: -p.discounts, prev: -pp.discounts, kind: "neg", indent: true },
    { label: "Ingresos por envío", cur: p.shippingIncome, prev: pp.shippingIncome, indent: true },
    { label: "Ingresos netos", cur: p.revenue, prev: pp.revenue, kind: "sub" },
    { label: "Costo de la mercancía vendida", cur: -p.cogs, prev: -pp.cogs, kind: "neg" },
    { label: "Utilidad bruta", cur: p.grossProfit, prev: pp.grossProfit, kind: "sub" },
    ...cats.map((x) => ({ label: EXPENSE_LABEL[x.c], cur: -x.v, prev: -x.prev, kind: "neg" as const, indent: true })),
    { label: "Comisiones bancarias y pasarelas", cur: -p.fees, prev: -pp.fees, kind: "neg", indent: true },
    { label: "Utilidad operativa", cur: p.operatingProfit, prev: pp.operatingProfit, kind: "total" },
  ];

  return (
    <>
      <PageHeader
        title="Finanzas"
        description="Cuánto vendes, cuánto te cuesta y cuánto te queda. Calculado en automático con cada venta y gasto."
        actions={
          <>
            <PeriodSelect value={period} onChange={setPeriod} options={["7d", "mes", "mes_pasado", "90d"]} />
            <ExpenseDialog />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Ingresos" value={mxn(p.revenue)} delta={change(p.revenue, pp.revenue)} icon={TrendingUp} />
        <KpiCard label="Utilidad bruta" value={mxn(p.grossProfit)} hint={<span>margen bruto <b className="text-foreground">{pct(p.grossMargin)}</b></span>} icon={Banknote} />
        <KpiCard label="Gastos operativos" value={mxn(p.opex + p.fees)} delta={change(p.opex + p.fees, pp.opex + pp.fees)} invertDelta icon={Receipt} />
        <KpiCard
          label="Utilidad operativa"
          value={mxn(p.operatingProfit)}
          hint={<span>margen operativo <b className="text-foreground">{pct(p.operatingMargin)}</b></span>}
          icon={Wallet}
          accent
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Estado de resultados · {PERIOD_LABEL[period]}</CardTitle>
            <CardDescription>Comparado contra el periodo anterior equivalente.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Concepto</th>
                  <th className="py-2 text-right font-medium">Actual</th>
                  <th className="py-2 text-right font-medium">% ingresos</th>
                  <th className="py-2 text-right font-medium">Anterior</th>
                  <th className="px-4 py-2 text-right font-medium">Var.</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.label}
                    className={cn("border-b last:border-0", l.kind === "sub" && "bg-muted/30 font-medium", l.kind === "total" && "bg-gold/10 font-semibold")}
                  >
                    <td className={cn("px-4 py-2", l.indent && "pl-8 text-muted-foreground")}>{l.label}</td>
                    <td className={cn("py-2 text-right tabular", l.cur < 0 && "text-muted-foreground")}>{mxn(l.cur)}</td>
                    <td className="py-2 text-right text-xs text-muted-foreground tabular">{p.revenue ? pct(Math.abs(l.cur) / p.revenue) : "—"}</td>
                    <td className="py-2 text-right text-muted-foreground tabular">{mxn(l.prev)}</td>
                    <td className="px-4 py-2 text-right">{l.prev !== 0 && <Delta value={change(Math.abs(l.cur), Math.abs(l.prev))} invert={l.kind === "neg"} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">Margen operativo</span>
            <span className="font-semibold tabular">
              {pct(p.operatingMargin)} <span className="ml-1 text-xs font-normal text-muted-foreground">(anterior {pct(pp.operatingMargin)})</span>
            </span>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <SectionTitle>Tendencia mensual</SectionTitle>
            </CardHeader>
            <CardContent>
              <FinanceBars data={d.months} height={230} />
              <p className="mt-2 text-xs text-muted-foreground">* Mes en curso, aún parcial.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionTitle action={<Scale className="size-4 text-muted-foreground" />}>Punto de equilibrio</SectionTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Para cubrir renta, nómina y servicios ({mxn(d.be.fixedMonthly)}/mes) necesitas vender al menos{" "}
                <b className="text-foreground">{mxn(d.be.breakEven)}</b> al mes.
              </p>
              <Progress value={Math.min(100, beProgress * 100)} className="h-2" />
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Este mes llevas {mxn(d.monthRevenue)}</span>
                <span className={cn("font-medium", beProgress >= 1 ? "text-success" : "text-warning")}>
                  {beProgress >= 1 ? `Cubierto · ${pct(beProgress - 1, 0)} arriba` : `${pct(beProgress, 0)} del objetivo`}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <SectionTitle>¿En qué se va el dinero?</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {cats
              .filter((x) => x.v > 0)
              .map((x) => (
                <ShareBar
                  key={x.c}
                  label={EXPENSE_LABEL[x.c]}
                  value={mxn(x.v)}
                  share={p.opex ? x.v / p.opex : 0}
                  color="var(--ch-tienda)"
                  sub={`${pct(p.revenue ? x.v / p.revenue : 0)} de tus ingresos`}
                />
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Dinero que entró · por método</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {d.cash.map(([m, v]) => (
              <ShareBar key={m} label={PAYMENT_LABEL[m]} value={mxn(v)} share={cashTotal ? v / cashTotal : 0} color="var(--ch-web)" />
            ))}
            <p className="text-xs text-muted-foreground">Total cobrado: {mxn(cashTotal)} · incluye anticipos de apartados.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle>Cuentas por cobrar · {mxn(arTotal)}</SectionTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {d.ar.slice(0, 7).map((o) => (
              <Link key={o.id} href={`/pedidos/${o.id}`} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 hover:opacity-80">
                <div className="min-w-0">
                  <div className="truncate font-medium">{o.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.folio} · {fRelative(o.date)}
                  </div>
                </div>
                <span className="font-medium tabular text-warning">{mxn(orderBalance(o))}</span>
              </Link>
            ))}
            {d.ar.length === 0 && <p className="text-sm text-muted-foreground">Sin saldos pendientes.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 gap-0 py-0">
        <CardHeader className="border-b py-4">
          <SectionTitle action={<span className="text-xs text-muted-foreground">{d.list.length} registros</span>}>Gastos del periodo</SectionTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Fecha</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.list.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-4 text-muted-foreground">{fDate(e.date)}</TableCell>
                <TableCell className="font-medium">{e.description}</TableCell>
                <TableCell className="text-muted-foreground">{EXPENSE_LABEL[e.category]}</TableCell>
                <TableCell className="text-muted-foreground">{e.branch ? branchName(e.branch) : "General"}</TableCell>
                <TableCell className="text-muted-foreground">{PAYMENT_LABEL[e.method]}</TableCell>
                <TableCell className="text-right font-medium tabular">{mxn(e.amount)}</TableCell>
                <TableCell className="pr-4">
                  <Button
                    variant={confirmId === e.id ? "destructive" : "ghost"}
                    size="icon-xs"
                    aria-label={confirmId === e.id ? "Confirmar eliminación" : "Eliminar gasto"}
                    onClick={() => {
                      if (confirmId !== e.id) return setConfirmId(e.id);
                      setConfirmId(null);
                      removeExpense(e.id)
                        .then(() => toast("Gasto eliminado"))
                        .catch((err) => toast.error(errorMessage(err)));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

export default function FinanzasPage() {
  const kind = useErp((s) => s.kind);
  return kind === "restaurante" ? <FinanzasRestaurante /> : <FinanzasBoutique />;
}
