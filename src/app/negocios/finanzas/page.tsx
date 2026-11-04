"use client";

import { Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { FinanceBars } from "@/components/charts";
import { change, KpiCard, PageHeader, PeriodSelect, ShareBar } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_LABEL, KIND_LABEL } from "@/lib/constants";
import { mxn, pct } from "@/lib/format";
import { periodRange, type Period } from "@/lib/metrics";
import { lastMonthsRange, monthlyRows, sumBy } from "@/lib/owner";
import type { ExpenseCategory } from "@/lib/types";
import { useOwner } from "../_components/owner-shell";
import { useOverview } from "../_components/use-overview";

const PERIODS: Period[] = ["mes", "mes_pasado", "90d"];

/** Descarga las filas como CSV (comillas escapadas). */
function downloadCsv(rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  a.download = "finanzas-negocios.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function NegociosFinanzasPage() {
  const { businesses } = useOwner();
  const [period, setPeriod] = useState<Period>("mes");
  const [filter, setFilter] = useState("todos");
  const range = useMemo(() => periodRange(period).cur, [period]);
  const six = useMemo(() => lastMonthsRange(6), []);
  const overview = useOverview(range.from, range.to);
  const history = useOverview(six.from, six.to);

  const ids = filter === "todos" ? null : [filter];
  const rows = overview?.businesses.filter((b) => !ids || ids.includes(b.id)) ?? [];
  const sum = (f: (b: (typeof rows)[number]) => number) => rows.reduce((a, b) => a + f(b), 0);
  const total = { revenue: sum((b) => b.revenue), cogs: sum((b) => b.cogs), spent: sum((b) => b.expenses + b.fees), profit: sum((b) => b.profit) };
  const categories = overview ? sumBy(overview.expenseCategories, "category", ids) : [];
  const waiting = businesses?.filter((b) => b.state === "revision" || b.state === "rechazada") ?? [];
  const margin = (profit: number, revenue: number) => (revenue ? pct(profit / revenue) : "—");

  return (
    <>
      <PageHeader
        title="Finanzas"
        description="Todos tus negocios activos."
        actions={
          <>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-9 w-48 bg-card" aria-label="Negocio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="todos">Todos</SelectItem>
                {overview?.businesses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PeriodSelect value={period} onChange={setPeriod} options={PERIODS} />
          </>
        }
      />
      {!overview || !history ? (
        <Loader2 className="mx-auto mt-24 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Ingresos" value={mxn(total.revenue)} delta={change(total.revenue, sum((b) => b.prevRevenue))} deltaLabel="vs. periodo anterior" />
            <KpiCard label="Costo de lo vendido" value={mxn(total.cogs)} hint={`Mercancía e insumos · ${margin(total.cogs, total.revenue)}`} />
            <KpiCard label="Gastos de operación" value={mxn(total.spent)} hint={`${margin(total.spent, total.revenue)} de los ingresos`} />
            <KpiCard label="Utilidad operativa" value={mxn(total.profit)} hint={`margen ${margin(total.profit, total.revenue)}`} accent />
          </div>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card className="gap-4 px-4">
              <h2 className="font-semibold">Ingresos contra gastos · últimos 6 meses</h2>
              <FinanceBars data={monthlyRows(history.byMonth, 6, ids)} />
            </Card>
            <Card className="gap-4 px-4">
              <h2 className="font-semibold">Gastos por categoría</h2>
              {categories.length === 0 && <p className="text-sm text-muted-foreground">Sin gastos en el periodo.</p>}
              {categories.map((c) => (
                <ShareBar key={c.key} label={EXPENSE_LABEL[c.key as ExpenseCategory] ?? c.key} value={mxn(c.amount)} share={c.amount / categories[0].amount} color="var(--ch-tienda)" />
              ))}
            </Card>
          </div>
          <Card className="gap-3 px-0">
            <div className="flex items-center justify-between px-4">
              <h2 className="font-semibold">Por negocio</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv([
                    ["Negocio", "Giro", "Ingresos", "Costo", "Gastos", "Utilidad", "Margen"],
                    ...rows.map((b) => [b.name, KIND_LABEL[b.kind], b.revenue, b.cogs, b.expenses + b.fees, b.profit, margin(b.profit, b.revenue)]),
                  ])
                }
              >
                <Download /> Exportar CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Negocio</TableHead>
                  <TableHead>Giro</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Gastos</TableHead>
                  <TableHead className="text-right">Utilidad</TableHead>
                  <TableHead className="pr-4 text-right">Margen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="pl-4 font-medium">{b.name}</TableCell>
                    <TableCell>{KIND_LABEL[b.kind]}</TableCell>
                    <TableCell className="text-right tabular">{mxn(b.revenue)}</TableCell>
                    <TableCell className="text-right tabular">{mxn(b.cogs)}</TableCell>
                    <TableCell className="text-right tabular">{mxn(b.expenses + b.fees)}</TableCell>
                    <TableCell className="text-right tabular">{mxn(b.profit)}</TableCell>
                    <TableCell className="pr-4 text-right tabular">{margin(b.profit, b.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4" colSpan={2}>
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular">{mxn(total.revenue)}</TableCell>
                  <TableCell className="text-right tabular">{mxn(total.cogs)}</TableCell>
                  <TableCell className="text-right tabular">{mxn(total.spent)}</TableCell>
                  <TableCell className="text-right tabular">{mxn(total.profit)}</TableCell>
                  <TableCell className="pr-4 text-right tabular">{margin(total.profit, total.revenue)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
          {waiting.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {waiting.map((b) => `${b.name} (${b.state === "revision" ? "en revisión" : "rechazado"})`).join(" y ")} no suma
              {waiting.length > 1 && "n"} hasta activarse.
            </p>
          )}
        </div>
      )}
    </>
  );
}
