"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CircleDollarSign,
  PackageMinus,
  PackagePlus,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { ColorSwatch, KpiCard, PageHeader } from "@/components/erp";
import { VariantQtyGrid } from "@/components/product-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fDateTime, mxn, num, pct } from "@/lib/format";
import { inventoryValue, replenishment } from "@/lib/metrics";
import { errorMessage, useActiveBranches, useBranchName, useCanMoveStock, useErp, useIsOwner, useWarehouse } from "@/lib/store";
import type { BranchId, Category, MovementType, Product, StockMap } from "@/lib/types";
import { cn } from "@/lib/utils";
import { hasKeySeparator, productStock, stockOf, variantKey, type QtyMap } from "@/lib/variants";

const MOVE_LABEL: Record<MovementType, { label: string; cls: string }> = {
  venta: { label: "Venta", cls: "bg-ch-web/12 text-ch-web" },
  entrada: { label: "Entrada", cls: "bg-success/12 text-success" },
  traspaso: { label: "Traspaso", cls: "bg-ch-mayoreo/12 text-ch-mayoreo" },
  ajuste: { label: "Ajuste", cls: "bg-warning/15 text-warning" },
  cancelacion: { label: "Devolución", cls: "bg-muted text-muted-foreground" },
};

type StockState = "ok" | "bajo" | "agotado";

function stockState(p: Product, stock: StockMap): StockState {
  let out = 0;
  let low = 0;
  const variants = p.colors.length * p.sizes.length;
  for (const c of p.colors)
    for (const s of p.sizes) {
      const n = stockOf(stock, variantKey(p.id, c.name, s));
      if (n === 0) out++;
      else if (n <= p.minStock) low++;
    }
  if (out === variants) return "agotado";
  if (out + low >= Math.ceil(variants / 3)) return "bajo";
  return "ok";
}

export default function InventarioPage() {
  return (
    <Suspense>
      <Inventario />
    </Suspense>
  );
}

function Inventario() {
  const params = useSearchParams();
  const products = useErp((s) => s.products);
  const stock = useErp((s) => s.stock);
  const orders = useErp((s) => s.orders);
  const movements = useErp((s) => s.movements);
  const owner = useIsOwner();
  const branches = useActiveBranches();
  const branchName = useBranchName();

  const [tab, setTab] = useState(params.get("tab") ?? "existencias");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [moveFilter, setMoveFilter] = useState<MovementType | "all">("all");
  const [moveLimit, setMoveLimit] = useState(60);

  const value = useMemo(() => inventoryValue(products, stock), [products, stock]);
  const repl = useMemo(() => replenishment(products, stock, orders), [products, stock, orders]);
  const outVariants = useMemo(() => Object.keys(stock).filter((k) => stockOf(stock, k) === 0).length, [stock]);

  const categories = [...new Set(products.map((p) => p.category))];
  const rows = products
    .filter((p) => (cat === "all" ? true : p.category === cat))
    .filter((p) => (q ? `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q.toLowerCase()) : true));

  const product = products.find((p) => p.id === selected);
  const reorder = repl.filter((r) => r.coverageDays < 21 && r.suggested > 0).sort((a, b) => a.coverageDays - b.coverageDays);
  const stale = repl.filter((r) => r.onHand > 0 && r.sold30 <= Math.max(2, r.onHand * 0.05)).sort((a, b) => b.capital - a.capital);
  const filteredMoves = movements.filter((m) => (moveFilter === "all" ? true : m.type === moveFilter));

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Existencias exactas por modelo, color, talla y sucursal. Cada venta, entrada y traspaso queda registrado."
        actions={<NewProductDialog onCreated={(id) => setSelected(id)} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Piezas en existencia" value={num(value.units)} hint={<span>{products.length} modelos · {branches.length} {branches.length === 1 ? "sucursal" : "sucursales"}</span>} icon={Boxes} />
        {owner ? (
          <>
            <KpiCard label="Inventario a costo" value={mxn(value.cost)} hint="dinero invertido en mercancía" icon={CircleDollarSign} accent />
            <KpiCard label="Valor a precio de venta" value={mxn(value.retail)} hint={<span>utilidad potencial {mxn(value.retail - value.cost)}</span>} icon={Tag} />
          </>
        ) : (
          <>
            <KpiCard label="Modelos por reabastecer" value={num(reorder.length)} hint="menos de 3 semanas de stock" icon={PackagePlus} />
            <KpiCard label="Modelos sin movimiento" value={num(stale.length)} hint="poca venta en 30 días" icon={PackageMinus} />
          </>
        )}
        <KpiCard label="Variantes agotadas" value={num(outVariants)} hint="color + talla sin piezas" icon={AlertTriangle} />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="existencias">Existencias</TabsTrigger>
          <TabsTrigger value="reabasto">
            Reabasto
            {reorder.length > 0 && <Badge className="ml-1 h-4 bg-warning/20 px-1.5 text-[10px] text-warning">{reorder.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="existencias">
          <Card className="gap-0 py-0">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center">
              <div className="relative md:w-72">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo, SKU o marca…" className="h-9 pl-8" />
              </div>
              <Select value={cat} onValueChange={(v) => setCat(v as Category | "all")}>
                <SelectTrigger className="h-9 md:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Modelo</TableHead>
                  {owner && <TableHead className="text-right">Costo</TableHead>}
                  <TableHead className="text-right">Precio</TableHead>
                  {owner && <TableHead className="text-right">Margen</TableHead>}
                  {branches.map((b) => (
                    <TableHead key={b.id} className="text-right">
                      {b.short}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-4">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const st = stockState(p, stock);
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => setSelected(p.id)}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-1">
                            {p.colors.slice(0, 3).map((c) => (
                              <ColorSwatch key={c.name} hex={c.hex} className="ring-2 ring-card" />
                            ))}
                          </div>
                          <div>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.sku} · {p.category}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      {owner && <TableCell className="text-right text-muted-foreground tabular">{mxn(p.cost)}</TableCell>}
                      <TableCell className="text-right tabular">{mxn(p.price)}</TableCell>
                      {owner && <TableCell className="text-right tabular">{pct((p.price - p.cost) / p.price, 0)}</TableCell>}
                      {branches.map((b) => (
                        <TableCell key={b.id} className="text-right tabular">
                          {productStock(p, stock, b.id)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-semibold tabular">{productStock(p, stock)}</TableCell>
                      <TableCell className="pr-4">
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-0 ring-1",
                            st === "ok" && "bg-success/12 text-success ring-success/30",
                            st === "bajo" && "bg-warning/15 text-warning ring-warning/30",
                            st === "agotado" && "bg-destructive/10 text-destructive ring-destructive/30",
                          )}
                        >
                          {st === "ok" ? "Surtido" : st === "bajo" ? "Tallas bajas" : "Agotado"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="reabasto" className="flex flex-col gap-4">
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Qué comprar y cuánto</CardTitle>
              <CardDescription>Basado en lo vendido en los últimos 30 días. Sugerencia para cubrir 45 días de venta.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Modelo</TableHead>
                  <TableHead className="text-right">Vendidas 30 días</TableHead>
                  <TableHead className="text-right">Existencia</TableHead>
                  <TableHead className="text-right">Te alcanza para</TableHead>
                  <TableHead className="text-right">Comprar</TableHead>
                  {owner && <TableHead className="pr-4 text-right">Inversión</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reorder.map((r) => (
                  <TableRow key={r.product.id} className="cursor-pointer" onClick={() => setSelected(r.product.id)}>
                    <TableCell className="pl-4 font-medium">{r.product.name}</TableCell>
                    <TableCell className="text-right tabular">{r.sold30}</TableCell>
                    <TableCell className="text-right tabular">{r.onHand}</TableCell>
                    <TableCell className={cn("text-right tabular", r.coverageDays < 10 ? "text-destructive" : "text-warning")}>
                      {Math.round(r.coverageDays)} días
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular">{r.suggested} pzs</TableCell>
                    {owner && <TableCell className="pr-4 text-right tabular">{mxn(r.suggested * r.product.cost)}</TableCell>}
                  </TableRow>
                ))}
                {reorder.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Todo tu inventario cubre más de 3 semanas de venta.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Mercancía detenida</CardTitle>
              <CardDescription>
                Modelos con poca venta en 30 días. {owner && "Es dinero parado: considera promoción, paquete de mayoreo o liquidación."}
              </CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Modelo</TableHead>
                  <TableHead className="text-right">Existencia</TableHead>
                  <TableHead className="text-right">Vendidas 30 días</TableHead>
                  {owner && <TableHead className="pr-4 text-right">Capital detenido</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {stale.map((r) => (
                  <TableRow key={r.product.id} className="cursor-pointer" onClick={() => setSelected(r.product.id)}>
                    <TableCell className="pl-4 font-medium">{r.product.name}</TableCell>
                    <TableCell className="text-right tabular">{r.onHand}</TableCell>
                    <TableCell className="text-right tabular">{r.sold30}</TableCell>
                    {owner && <TableCell className="pr-4 text-right font-medium tabular">{mxn(r.capital)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="movimientos">
          <Card className="gap-0 py-0">
            <div className="flex flex-wrap gap-1.5 border-b p-4">
              {(["all", "venta", "entrada", "traspaso", "ajuste", "cancelacion"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMoveFilter(t)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    moveFilter === t ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                  )}
                >
                  {t === "all" ? "Todos" : MOVE_LABEL[t].label}
                </button>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="pr-4">Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMoves.slice(0, moveLimit).map((m) => {
                  const [, color, size] = m.variantKey.split("|");
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="pl-4 text-muted-foreground">{fDateTime(m.date)}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", MOVE_LABEL[m.type].cls)}>{MOVE_LABEL[m.type].label}</span>
                      </TableCell>
                      <TableCell className="max-w-52 truncate">{products.find((p) => p.id === m.productId)?.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {color} · {size}
                      </TableCell>
                      <TableCell>{branchName(m.branch)}</TableCell>
                      <TableCell className={cn("text-right font-medium tabular", m.qty > 0 && "text-success")}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TableCell>
                      <TableCell className="pr-4 text-xs text-muted-foreground">
                        {m.ref}
                        {m.note && <span className="block">{m.note}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filteredMoves.length > moveLimit && (
              <div className="flex justify-center border-t p-3">
                <Button variant="outline" size="sm" onClick={() => setMoveLimit((l) => l + 100)}>
                  Ver más movimientos
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet open={!!product} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">{product && <ProductSheet key={product.id} product={product} />}</SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Detalle de producto                                                  */
/* ------------------------------------------------------------------ */
function ProductSheet({ product }: { product: Product }) {
  const stock = useErp((s) => s.stock);
  const movements = useErp((s) => s.movements);
  const updateProduct = useErp((s) => s.updateProduct);
  const owner = useIsOwner();
  const canMoveStock = useCanMoveStock();
  const branches = useActiveBranches();
  const branchName = useBranchName();
  const [view, setView] = useState<BranchId | "all">("all");
  const [price, setPrice] = useState(product.price);
  const [cost, setCost] = useState(product.cost);
  const history = movements.filter((m) => m.productId === product.id).slice(0, 12);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-lg">{product.name}</SheetTitle>
        <SheetDescription>
          {product.sku} · {product.brand} · {product.category}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 px-4 pb-6">
        {canMoveStock && (
          <div className="flex flex-wrap gap-2">
            <StockMoveDialog product={product} kind="entrada" />
            <StockMoveDialog product={product} kind="traspaso" />
            <StockMoveDialog product={product} kind="ajuste" />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Existencias por talla</span>
            <Tabs value={view} onValueChange={(v) => setView(v as BranchId | "all")}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">
                  Total
                </TabsTrigger>
                {branches.map((b) => (
                  <TabsTrigger key={b.id} value={b.id} className="text-xs">
                    {b.short}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Color</th>
                  {product.sizes.map((s) => (
                    <th key={s} className="px-2 py-2 text-center font-medium">
                      {s}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {product.colors.map((c) => {
                  const counts = product.sizes.map((s) => stockOf(stock, variantKey(product.id, c.name, s), view === "all" ? undefined : view));
                  return (
                    <tr key={c.name} className="border-t">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <ColorSwatch hex={c.hex} /> {c.name}
                        </span>
                      </td>
                      {counts.map((n, i) => (
                        <td key={i} className="px-2 py-2 text-center tabular">
                          <span
                            className={cn(
                              "inline-grid min-w-8 place-items-center rounded-md px-1.5 py-0.5",
                              n === 0 ? "bg-destructive/10 text-destructive" : n <= product.minStock ? "bg-warning/15 text-warning" : "",
                            )}
                          >
                            {n}
                          </span>
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold tabular">{counts.reduce((a, b) => a + b, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Mínimo por talla: {product.minStock} pzs. En rojo: agotado · en ámbar: por debajo del mínimo.
          </p>
        </div>

        {owner && (
          <div className="grid gap-3 rounded-xl border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal className="size-4" /> Precio y costo
            </div>
            <div className="grid grid-cols-3 items-end gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Costo</Label>
                <Input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value) || 0)} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Precio de lista</Label>
                <Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  updateProduct(product.id, { price, cost })
                    .then(() => toast.success("Precio actualizado"))
                    .catch((e) => toast.error(errorMessage(e)));
                }}
              >
                Guardar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Margen: <b className="text-foreground">{pct(price ? (price - cost) / price : 0)}</b> · Utilidad por pieza {mxn(price - cost)}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Últimos movimientos</span>
          <div className="flex flex-col divide-y rounded-lg border">
            {history.length === 0 && <p className="p-3 text-sm text-muted-foreground">Sin movimientos recientes.</p>}
            {history.map((m) => {
              const [, color, size] = m.variantKey.split("|");
              return (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", MOVE_LABEL[m.type].cls)}>{MOVE_LABEL[m.type].label}</span>
                      <span className="truncate">
                        {color} · {size} · {branchName(m.branch)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fDateTime(m.date)} {m.ref && `· ${m.ref}`} {m.note && `· ${m.note}`}
                    </div>
                  </div>
                  <span className={cn("font-medium tabular", m.qty > 0 && "text-success")}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Entradas, traspasos y ajustes                                        */
/* ------------------------------------------------------------------ */
const MOVE_META = {
  entrada: { label: "Entrada de mercancía", icon: PackagePlus, desc: "Registra lo que llegó del proveedor, por color y talla." },
  traspaso: { label: "Traspaso", icon: ArrowLeftRight, desc: "Mueve piezas entre sucursales." },
  ajuste: { label: "Ajuste", icon: SlidersHorizontal, desc: "Corrige por conteo físico, merma o prenda dañada." },
};

function StockMoveDialog({ product, kind }: { product: Product; kind: "entrada" | "traspaso" | "ajuste" }) {
  const moveStock = useErp((s) => s.moveStock);
  const transferStock = useErp((s) => s.transferStock);
  const branches = useActiveBranches();
  const warehouse = useWarehouse();
  const branchName = useBranchName();
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState<BranchId>((warehouse ?? branches[0])?.id ?? "");
  const [to, setTo] = useState<BranchId>(branches.find((b) => b.id !== (warehouse ?? branches[0])?.id)?.id ?? "");
  const [qty, setQty] = useState<QtyMap>({});
  const [ref, setRef] = useState("");
  const [sign, setSign] = useState<1 | -1>(-1);
  const [saving, setSaving] = useState(false);
  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  const meta = MOVE_META[kind];
  const Icon = meta.icon;

  const submit = async () => {
    const entries = Object.entries(qty)
      .filter(([, v]) => v > 0)
      .map(([key, v]) => ({ variantKey: key, qty: v }));
    if (!entries.length) return toast.error("Captura al menos una pieza");
    if (kind === "traspaso" && branch === to) return toast.error("Elige sucursales distintas");
    setSaving(true);
    try {
      if (kind === "entrada") {
        await moveStock(entries, branch, "entrada", { ref: ref.trim() || undefined, note: product.brand ? `Proveedor ${product.brand}` : undefined });
        toast.success(`+${total} piezas en ${branchName(branch)}`);
      } else if (kind === "traspaso") {
        await transferStock(entries, branch, to);
        toast.success(`${total} piezas traspasadas de ${branchName(branch)} a ${branchName(to)}`);
      } else {
        await moveStock(
          entries.map((e) => ({ ...e, qty: e.qty * sign })),
          branch,
          "ajuste",
          { note: ref || (sign < 0 ? "Merma / conteo físico" : "Conteo físico") },
        );
        toast.success(`Ajuste de ${sign > 0 ? "+" : "−"}${total} piezas en ${branchName(branch)}`);
      }
    } catch (e) {
      return toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
    setQty({});
    setRef("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={kind === "entrada" ? "default" : "outline"} size="sm" disabled={kind === "traspaso" && branches.length < 2}>
          <Icon /> {meta.label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {meta.label} · {product.name}
          </DialogTitle>
          <DialogDescription>{meta.desc}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{kind === "traspaso" ? "Desde" : "Sucursal"}</Label>
              <Select
                value={branch}
                onValueChange={(v) => {
                  setBranch(v as BranchId);
                  if (v === to) setTo(branches.find((b) => b.id !== v)?.id ?? "");
                  setQty({});
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind === "traspaso" && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Hacia</Label>
                <Select value={to} onValueChange={(v) => setTo(v as BranchId)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches
                      .filter((b) => b.id !== branch)
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {kind === "ajuste" && (
              <div className="flex gap-1.5">
                <Button size="sm" variant={sign < 0 ? "default" : "outline"} onClick={() => setSign(-1)}>
                  Restar
                </Button>
                <Button size="sm" variant={sign > 0 ? "default" : "outline"} onClick={() => setSign(1)}>
                  Sumar
                </Button>
              </div>
            )}
            {kind !== "traspaso" && (
              <div className="grid min-w-40 flex-1 gap-1.5">
                <Label className="text-xs">{kind === "entrada" ? "Orden de compra / factura" : "Motivo"}</Label>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={kind === "entrada" ? "OC-2231" : "Prenda dañada"} />
              </div>
            )}
          </div>
          <VariantQtyGrid
            product={product}
            branch={branch}
            qty={qty}
            onChange={(k, v) => setQty({ ...qty, [k]: v })}
            mode={kind === "entrada" || (kind === "ajuste" && sign > 0) ? "in" : "out"}
          />
        </div>
        <DialogFooter>
          <span className="mr-auto self-center text-sm text-muted-foreground">{total} piezas</span>
          <Button disabled={saving} onClick={() => void submit()}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Alta de producto                                                     */
/* ------------------------------------------------------------------ */
const nextSku = (taken: string[]) => {
  let n = taken.length + 1;
  while (taken.includes(`SKU-${String(n).padStart(4, "0")}`)) n++;
  return `SKU-${String(n).padStart(4, "0")}`;
};

function NewProductDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const addProduct = useErp((s) => s.addProduct);
  const products = useErp((s) => s.products);
  const catalog = useErp((s) => s.catalog);
  const businessName = useErp((s) => s.business?.name ?? "");
  const [open, setOpen] = useState(false);
  const blank = () => ({
    name: "",
    brand: businessName,
    category: catalog.categories[0] ?? "",
    cost: 0,
    price: 0,
    preset: catalog.sizePresets[0]?.name ?? "",
    colors: "Negro, Blanco",
  });
  const [f, setF] = useState(blank);
  const sizes = catalog.sizePresets.find((p) => p.name === f.preset)?.sizes ?? [];
  const missingSetup = catalog.categories.length === 0 || catalog.sizePresets.length === 0;
  const colorList = [...new Set(f.colors.split(",").map((c) => c.trim()).filter(Boolean))];
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!f.name.trim() || f.price <= 0) return toast.error("Nombre y precio son obligatorios");
    if (!f.category || !sizes.length) return toast.error("Elige categoría y tallas");
    if (colorList.some(hasKeySeparator)) return toast.error("Los colores no pueden llevar el carácter «|»");
    const palette = ["#111111", "#f4f4f2", "#1c2a44", "#5e1a26", "#cbb89a", "#56603a", "#8a8a8a"];
    setSaving(true);
    let p: Product;
    try {
      p = await addProduct({
      sku: nextSku(products.map((x) => x.sku)),
      name: f.name.trim(),
      brand: f.brand.trim(),
      category: f.category,
      cost: f.cost,
      price: f.price,
      sizes,
      colors: colorList.map((name, i) => ({ name, hex: palette[i % palette.length] })),
      minStock: 2,
      active: true,
      });
    } catch (e) {
      return toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
    toast.success(`${p.name} dado de alta · registra su primera entrada`);
    setOpen(false);
    setF(blank());
    onCreated(p.id);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-9">
          <Plus /> Nuevo producto
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo producto</DialogTitle>
          <DialogDescription>Se crean automáticamente todas sus variantes de color y talla.</DialogDescription>
        </DialogHeader>
        {missingSetup && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Faltan categorías o juegos de tallas. Defínelos en{" "}
            <Link href="/configuracion" className="font-medium underline underline-offset-2">
              Configuración
            </Link>{" "}
            para poder dar de alta productos.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Nombre</Label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Blusa de lino manga corta" />
          </div>
          <div className="grid gap-1.5">
            <Label>Marca</Label>
            <Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Categoría</Label>
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Costo</Label>
            <Input type="number" value={f.cost || ""} onChange={(e) => setF({ ...f, cost: Number(e.target.value) || 0 })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Precio de venta</Label>
            <Input type="number" value={f.price || ""} onChange={(e) => setF({ ...f, price: Number(e.target.value) || 0 })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Tallas</Label>
            <Select value={f.preset} onValueChange={(v) => setF({ ...f, preset: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.sizePresets.map(({ name }) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Colores (separados por coma)</Label>
            <Input value={f.colors} onChange={(e) => setF({ ...f, colors: e.target.value })} />
          </div>
          {f.price > 0 && f.cost > 0 && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Margen de {pct((f.price - f.cost) / f.price)} · {sizes.length * colorList.length} variantes
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={saving || missingSetup} onClick={() => void submit()}>Crear producto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
