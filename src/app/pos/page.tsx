"use client";

import { Banknote, CreditCard, Landmark, Minus, Plus, Printer, Receipt, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CustomerSelect } from "@/components/customer-picker";
import { ColorSwatch, PageHeader } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PAYMENT_LABEL } from "@/lib/constants";
import { fDateTime, mxn } from "@/lib/format";
import { errorMessage, useBranches, useBusinessName, useErp, useIsOwner, usePosBranches } from "@/lib/store";
import type { BranchId, Category, Customer, LineItem, Order, PaymentMethod, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { productStock, stockOf, variantKey } from "@/lib/variants";

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: "efectivo", label: "Efectivo", icon: Banknote },
  { id: "tarjeta", label: "Tarjeta", icon: CreditCard },
  { id: "transferencia", label: "Transferencia", icon: Landmark },
];

export default function PosPage() {
  const products = useErp((s) => s.products);
  const stock = useErp((s) => s.stock);
  const orders = useErp((s) => s.orders);
  const createOrder = useErp((s) => s.createOrder);
  const [charging, setCharging] = useState(false);

  const profile = useErp((s) => s.profile);
  const settings = useErp((s) => s.profileSettings);
  const businessName = useBusinessName();
  const allBranches = useBranches();
  const posBranches = usePosBranches();
  const owner = useIsOwner();
  const [selectedBranch, setBranch] = useState<BranchId | undefined>();
  // Vendedores y encargados solo cobran en su sucursal asignada; el dueño puede elegir (por defecto la primera).
  const seller = posBranches.find((b) => b.id === profile?.branch);
  const current = owner ? (posBranches.find((b) => b.id === selectedBranch) ?? posBranches[0]) : seller;
  const branch = current?.id ?? "";
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<LineItem[]>([]);
  const [customer, setCustomer] = useState<Customer | undefined>();
  const [discountPct, setDiscountPct] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [received, setReceived] = useState(0);
  const [ticket, setTicket] = useState<Order | null>(null);
  const [showCut, setShowCut] = useState(false);

  const categories = [...new Set(products.filter((p) => p.active).map((p) => p.category))];
  const list = products
    .filter((p) => p.active)
    .filter((p) => (cat === "all" ? true : p.category === cat))
    .filter((p) => (q ? `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase()) : true));

  const subtotal = cart.reduce((a, it) => a + it.qty * it.unitPrice, 0);
  const discount = Math.round((subtotal * discountPct) / 100);
  const total = subtotal - discount;
  const pieces = cart.reduce((a, it) => a + it.qty, 0);

  const add = (p: Product, color: string, size: string) => {
    const key = variantKey(p.id, color, size);
    const inCart = cart.find((it) => it.variantKey === key)?.qty ?? 0;
    if (inCart + 1 > stockOf(stock, key, branch)) return toast.error("Sin stock suficiente en esta sucursal");
    setCart((c) =>
      c.some((it) => it.variantKey === key)
        ? c.map((it) => (it.variantKey === key ? { ...it, qty: it.qty + 1 } : it))
        : [...c, { productId: p.id, variantKey: key, name: p.name, color, size, qty: 1, unitPrice: p.price, unitCost: p.cost, listPrice: p.price }],
    );
  };

  const setLineQty = (key: string, qty: number) => {
    if (qty > stockOf(stock, key, branch)) return toast.error("Sin stock suficiente en esta sucursal");
    setCart((c) => (qty <= 0 ? c.filter((it) => it.variantKey !== key) : c.map((it) => (it.variantKey === key ? { ...it, qty } : it))));
  };

  const charge = async () => {
    if (!cart.length || charging) return;
    if (method === "efectivo" && received > 0 && received < total) return toast.error("El efectivo recibido no cubre el total");
    setCharging(true);
    let order: Order;
    try {
      order = await createOrder({
        channel: "tienda",
        customerId: customer?.id,
        customerName: customer ? customer.name : "Público general",
        branch,
        items: cart,
        discount,
        payments: [{ amount: total, method }],
        status: "entregado",
      });
    } catch (e) {
      return toast.error(errorMessage(e));
    } finally {
      setCharging(false);
    }
    setTicket(order);
    setCart([]);
    setCustomer(undefined);
    setDiscountPct(0);
    setReceived(0);
    toast.success(`Venta ${order.folio} cobrada · ${mxn(order.total)}`);
  };

  const cut = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = orders.filter((o) => o.channel === "tienda" && o.branch === branch && o.status !== "cancelado" && new Date(o.date) >= start);
    const byMethod = new Map<PaymentMethod, number>();
    for (const o of today) for (const p of o.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
    return {
      count: today.length,
      total: today.reduce((a, o) => a + o.total, 0),
      pieces: today.reduce((a, o) => a + o.items.reduce((b, it) => b + it.qty, 0), 0),
      byMethod,
    };
  }, [orders, branch]);

  const branchLabel = current?.name;

  if (!current) {
    return (
      <>
        <PageHeader title="Punto de venta" description="Cobra en mostrador; cada venta descuenta el inventario de la sucursal al instante." />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {owner
              ? "Ninguna sucursal tiene punto de venta. Actívalo en Configuración, en Sucursales."
              : !profile?.branch
                ? "Pide al dueño que te asigne una sucursal."
                : "Tu sucursal no tiene punto de venta. Pide al dueño que lo revise."}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Punto de venta"
        description="Cobra en mostrador; cada venta descuenta el inventario de la sucursal al instante."
        actions={
          <>
            {owner ? (
              <Select
                value={branch}
                onValueChange={(v) => {
                  setBranch(v as BranchId);
                  setCart([]);
                }}
              >
                <SelectTrigger className="h-9 w-52 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {posBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-9 items-center rounded-md border bg-card px-3 text-sm">{branchLabel}</div>
            )}
            <Button variant="outline" className="h-9" onClick={() => setShowCut(true)}>
              <Receipt /> Corte de caja
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar prenda o SKU…" className="h-11 bg-card pl-9 text-base" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(["all", ...categories] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors",
                  cat === c ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
                )}
              >
                {c === "all" ? "Todo" : c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {list.map((p) => {
              const avail = productStock(p, stock, branch);
              return (
                <button
                  key={p.id}
                  disabled={avail === 0}
                  onClick={() => setPicking(p)}
                  className="group flex flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-40"
                >
                  <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-gradient-to-br from-muted to-muted/40">
                    <div className="flex -space-x-1.5">
                      {p.colors.slice(0, 4).map((c) => (
                        <ColorSwatch key={c.name} hex={c.hex} className="size-6 ring-2 ring-card" />
                      ))}
                    </div>
                  </div>
                  <div className="line-clamp-2 text-sm leading-snug font-medium">{p.name}</div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="font-semibold tabular">{mxn(p.price)}</span>
                    <span className={cn("text-xs tabular", avail <= 3 ? "text-warning" : "text-muted-foreground")}>{avail} pzs</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <ShoppingCart className="size-4" /> Venta actual
              </span>
              {cart.length > 0 && (
                <Button variant="ghost" size="xs" onClick={() => setCart([])}>
                  <X /> Vaciar
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {cart.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Toca una prenda para agregarla.</p>
            ) : (
              <div className="flex max-h-72 flex-col divide-y overflow-y-auto">
                {cart.map((it) => (
                  <div key={it.variantKey} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.color} · {it.size} · {mxn(it.unitPrice)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon-xs" onClick={() => setLineQty(it.variantKey, it.qty - 1)} aria-label="Menos">
                        {it.qty === 1 ? <Trash2 /> : <Minus />}
                      </Button>
                      <span className="w-6 text-center text-sm tabular">{it.qty}</span>
                      <Button variant="outline" size="icon-xs" onClick={() => setLineQty(it.variantKey, it.qty + 1)} aria-label="Más">
                        <Plus />
                      </Button>
                    </div>
                    <span className="w-16 text-right text-sm font-medium tabular">{mxn(it.qty * it.unitPrice)}</span>
                  </div>
                ))}
              </div>
            )}

            <CustomerSelect value={customer?.id} onChange={setCustomer} allowGeneral />

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Descuento</span>
              {[0, 5, 10, 15].map((d) => (
                <Button key={d} size="xs" variant={discountPct === d ? "default" : "outline"} onClick={() => setDiscountPct(d)}>
                  {d}%
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {METHODS.map((m) => (
                <Button key={m.id} variant={method === m.id ? "default" : "outline"} className="h-12 flex-col gap-0.5 text-xs" onClick={() => setMethod(m.id)}>
                  <m.icon className="size-4" />
                  {m.label}
                </Button>
              ))}
            </div>
            {method === "efectivo" && cart.length > 0 && (
              <div className="grid grid-cols-2 items-center gap-2">
                <Input type="number" placeholder="Recibido" value={received || ""} onChange={(e) => setReceived(Number(e.target.value) || 0)} />
                <span className="text-right text-sm">
                  Cambio: <b className="tabular">{mxn(Math.max(0, received - total))}</b>
                </span>
              </div>
            )}

            <Separator />
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal ({pieces} pzs)</span>
                <span className="tabular text-foreground">{mxn(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Descuento {discountPct}%</span>
                  <span className="tabular text-foreground">−{mxn(discount)}</span>
                </div>
              )}
            </div>
            <Button className="h-12 text-base" disabled={!cart.length || charging} onClick={() => void charge()}>
              Cobrar {mxn(total)}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Selección de color y talla */}
      <Dialog open={!!picking} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent className="sm:max-w-md">
          {picking && (
            <>
              <DialogHeader>
                <DialogTitle>{picking.name}</DialogTitle>
                <DialogDescription>
                  {mxn(picking.price)} · Toca la talla para agregar (stock en {current.short})
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {picking.colors.map((c) => (
                  <div key={c.name} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ColorSwatch hex={c.hex} /> {c.name}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {picking.sizes.map((s) => {
                        const key = variantKey(picking.id, c.name, s);
                        const avail = stockOf(stock, key, branch) - (cart.find((it) => it.variantKey === key)?.qty ?? 0);
                        return (
                          <Button key={s} variant="outline" className="h-12 w-16 flex-col gap-0" disabled={avail <= 0} onClick={() => add(picking, c.name, s)}>
                            <span className="font-semibold">{s}</span>
                            <span className="text-[10px] text-muted-foreground">{Math.max(0, avail)} pzs</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={() => setPicking(null)}>Listo</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Ticket */}
      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Venta registrada</DialogTitle>
            <DialogDescription>Ticket listo para imprimir.</DialogDescription>
          </DialogHeader>
          {ticket && (
            <div className="print-area rounded-lg bg-white p-4 font-mono text-[11px] text-neutral-900">
              <div className="flex flex-col items-center gap-1 text-center">
                {settings.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.logoUrl} alt={businessName} className="size-12 object-contain" />
                )}
                <div className="font-display text-base font-semibold tracking-[0.2em] uppercase">{businessName}</div>
                <div>{allBranches.find((b) => b.id === ticket.branch)?.name}</div>
                <div>{fDateTime(ticket.date)}</div>
                <div>
                  Folio {ticket.folio} · Atendió {ticket.seller}
                </div>
              </div>
              <div className="my-2 border-t border-dashed border-neutral-400" />
              {ticket.items.map((it) => (
                <div key={it.variantKey} className="flex justify-between gap-2">
                  <span className="truncate">
                    {it.qty}× {it.name} {it.size}
                  </span>
                  <span>{mxn(it.qty * it.unitPrice)}</span>
                </div>
              ))}
              <div className="my-2 border-t border-dashed border-neutral-400" />
              {ticket.discount > 0 && (
                <div className="flex justify-between">
                  <span>Descuento</span>
                  <span>−{mxn(ticket.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold">
                <span>TOTAL</span>
                <span>{mxn(ticket.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>{PAYMENT_LABEL[ticket.payments[0]?.method ?? "efectivo"]}</span>
                <span>{mxn(ticket.total)}</span>
              </div>
              {(settings.ticketFooter || settings.instagram) && (
                <div className="mt-3 text-center">{[settings.ticketFooter, settings.instagram].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Imprimir
            </Button>
            <Button onClick={() => setTicket(null)}>Nueva venta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Corte de caja */}
      <Dialog open={showCut} onOpenChange={setShowCut}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Corte de caja · hoy</DialogTitle>
            <DialogDescription>{branchLabel}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/60 p-2">
                <div className="text-lg font-semibold tabular">{cut.count}</div>
                <div className="text-xs text-muted-foreground">tickets</div>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <div className="text-lg font-semibold tabular">{cut.pieces}</div>
                <div className="text-xs text-muted-foreground">piezas</div>
              </div>
              <div className="rounded-lg bg-muted/60 p-2">
                <div className="text-lg font-semibold tabular">{mxn(cut.total)}</div>
                <div className="text-xs text-muted-foreground">vendido</div>
              </div>
            </div>
            <Separator className="my-1" />
            {METHODS.map((m) => (
              <div key={m.id} className="flex justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <m.icon className="size-4" /> {m.label}
                </span>
                <span className="font-medium tabular">{mxn(cut.byMethod.get(m.id) ?? 0)}</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">
              Efectivo esperado en caja: {mxn(cut.byMethod.get("efectivo") ?? 0)} más el fondo inicial.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
