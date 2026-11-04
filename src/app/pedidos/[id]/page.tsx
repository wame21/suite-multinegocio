"use client";

import {
  ArrowLeft,
  Ban,
  Check,
  CircleDollarSign,
  FileText,
  MessageCircle,
  PackageCheck,
  Printer,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChannelBadge, EmptyState, PageHeader, StatusBadge } from "@/components/erp";
import { SalesDocument } from "@/components/sales-document";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { onlyDigits } from "@/lib/clabe";
import { CUSTOMER_TYPE_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/constants";
import { fDateTime, mxn, pct } from "@/lib/format";
import { orderBalance, orderCost, orderFees, orderPaid } from "@/lib/metrics";
import { errorMessage, useBranchName, useBusinessName, useCanCancelOrders, useErp, useIsOwner } from "@/lib/store";
import type { Order, OrderStatus, PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TIERS } from "@/lib/wholesale";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pendiente", label: "Pedido" },
  { status: "pagado", label: "Pagado" },
  { status: "enviado", label: "Enviado" },
  { status: "entregado", label: "Entregado" },
];
const RANK: Record<OrderStatus, number> = { pendiente: 0, apartado: 0, pagado: 1, enviado: 2, entregado: 3, cancelado: -1 };

export default function PedidoDetalle() {
  const { id } = useParams<{ id: string }>();
  const order = useErp((s) => s.orders.find((o) => o.id === id));
  const customer = useErp((s) => s.customers.find((c) => c.id === order?.customerId));
  const owner = useIsOwner();
  const businessName = useBusinessName();
  const branchName = useBranchName();
  const [showDoc, setShowDoc] = useState(false);

  if (!order) {
    return <EmptyState icon={FileText} title="Pedido no encontrado" />;
  }

  const paid = orderPaid(order);
  const balance = orderBalance(order);
  const cost = orderCost(order);
  const fees = orderFees(order);
  const net = order.subtotal - order.discount;
  const profit = net - cost - fees;
  const pickup = order.pickup;
  const rank = RANK[order.status];
  // Si el nivel ya no existe en la configuración, el pedido se muestra sin nivel.
  const tier = order.tierId ? TIERS.find((t) => t.id === order.tierId) : undefined;
  const waPhone = customer ? `52${onlyDigits(customer.phone).slice(-10)}` : "";
  const waText = encodeURIComponent(
    `Hola ${customer?.name.split(" ")[0] ?? ""}, te saluda ${businessName}. Tu pedido ${order.folio} está: ${STATUS_LABEL[order.status]}.` +
      (order.shippingInfo?.tracking ? ` Guía${order.shippingInfo.carrier ? ` ${order.shippingInfo.carrier}` : ""}: ${order.shippingInfo.tracking}.` : "") +
      (balance > 0 ? ` Saldo pendiente: ${mxn(balance)}.` : ""),
  );

  return (
    <>
      <PageHeader
        title={`Pedido ${order.folio}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {fDateTime(order.date)} · <ChannelBadge channel={order.channel} /> · Surtido desde {branchName(order.branch)}
            {order.seller && <> · Atendió {order.seller}</>}
          </span>
        }
        actions={
          <>
            <Button asChild variant="ghost" className="h-9">
              <Link href="/pedidos">
                <ArrowLeft /> Pedidos
              </Link>
            </Button>
            {customer && (
              <Button asChild variant="outline" className="h-9">
                <a href={`https://wa.me/${waPhone}?text=${waText}`} target="_blank" rel="noreferrer">
                  <MessageCircle /> Avisar por WhatsApp
                </a>
              </Button>
            )}
            <Button variant="outline" className="h-9" onClick={() => setShowDoc((v) => !v)}>
              <FileText /> {showDoc ? "Ocultar nota" : "Nota de venta"}
            </Button>
          </>
        }
      />

      {showDoc && (
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex justify-end print:hidden">
            <Button onClick={() => window.print()}>
              <Printer /> Imprimir / guardar PDF
            </Button>
          </div>
          <SalesDocument
            kind="nota"
            folio={order.folio}
            date={order.date}
            customer={customer}
            customerName={order.customerName}
            items={order.items}
            discount={order.discount}
            shipping={order.shipping}
            total={order.total}
            tierName={tier?.name}
            tierDiscount={tier?.discount}
            paid={paid}
            notes={order.notes}
          />
        </div>
      )}

      <div className="grid gap-4 print:hidden xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} />
                  <span className="text-sm text-muted-foreground">{STATUS_LABEL[order.status]}</span>
                </div>
                <OrderActions order={order} balance={balance} pickup={pickup} />
              </div>
              {order.status !== "cancelado" && (
                <div className="grid grid-cols-4 gap-2">
                  {STEPS.map((s, i) => {
                    const done = rank >= i;
                    return (
                      <div key={s.status} className="flex flex-col gap-1.5">
                        <div className={cn("h-1.5 rounded-full", done ? "bg-gold" : "bg-muted")} />
                        <span className={cn("text-xs", done ? "font-medium" : "text-muted-foreground")}>
                          {i === 0 && order.status === "apartado" ? "Apartado" : s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Productos ({order.items.reduce((a, it) => a + it.qty, 0)} piezas)</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Producto</th>
                    <th className="py-2 font-medium">Color</th>
                    <th className="py-2 font-medium">Talla</th>
                    <th className="py-2 text-right font-medium">Cant.</th>
                    <th className="py-2 text-right font-medium">Precio</th>
                    {owner && <th className="py-2 text-right font-medium">Costo</th>}
                    <th className="px-4 py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.variantKey} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">{it.name}</td>
                      <td className="py-2.5">{it.color}</td>
                      <td className="py-2.5">{it.size}</td>
                      <td className="py-2.5 text-right tabular">{it.qty}</td>
                      <td className="py-2.5 text-right tabular">
                        {mxn(it.unitPrice)}
                        {it.unitPrice < it.listPrice && <div className="text-[11px] text-muted-foreground line-through">{mxn(it.listPrice)}</div>}
                      </td>
                      {owner && <td className="py-2.5 text-right text-muted-foreground tabular">{mxn(it.unitCost)}</td>}
                      <td className="px-4 py-2.5 text-right font-medium tabular">{mxn(it.qty * it.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pagos recibidos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y">
              {order.payments.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay pagos registrados.</p>}
              {order.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 text-sm first:pt-0">
                  <div>
                    <div className="font-medium">{PAYMENT_LABEL[p.method]}</div>
                    <div className="text-xs text-muted-foreground">
                      {fDateTime(p.date)}
                      {p.note && ` · ${p.note}`}
                    </div>
                  </div>
                  <span className="font-medium tabular text-success">+{mxn(p.amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <Row label="Subtotal" value={mxn(order.subtotal)} />
              {order.discount > 0 && <Row label="Descuento" value={`−${mxn(order.discount)}`} />}
              <Row label="Envío" value={order.shipping ? mxn(order.shipping) : "—"} />
              <Separator className="my-1" />
              <Row label="Total" value={mxn(order.total)} strong />
              <Row label="Pagado" value={mxn(paid)} />
              <Row label="Saldo" value={mxn(balance)} className={balance > 0 ? "text-warning" : ""} />
              {owner && (
                <div className="mt-3 flex flex-col gap-1 rounded-lg bg-muted/60 p-3 text-xs">
                  <div className="mb-1 font-medium text-foreground">Rentabilidad del pedido</div>
                  <Row label="Costo de mercancía" value={mxn(cost)} />
                  <Row label="Comisión de cobro" value={mxn(fees)} />
                  <Row label="Utilidad" value={`${mxn(profit)} · ${pct(net ? profit / net : 0)}`} strong />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cliente</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="font-medium">{order.customerName}</div>
              {customer ? (
                <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                  {customer.business && <span>{customer.name}</span>}
                  <span>
                    {CUSTOMER_TYPE_LABEL[customer.type]} · {customer.city}, {customer.state}
                  </span>
                  <span>Tel. {customer.phone}</span>
                  {customer.instagram && <span>{customer.instagram}</span>}
                  <Link href={`/clientes?c=${customer.id}`} className="mt-1 text-xs text-gold hover:underline">
                    Ver historial del cliente →
                  </Link>
                </div>
              ) : (
                <p className="text-muted-foreground">Venta de mostrador</p>
              )}
            </CardContent>
          </Card>

          {(order.shippingInfo || order.notes || pickup) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Entrega</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                {pickup && <span>Recoge en sucursal</span>}
                {order.shippingInfo?.city && <span>Destino: {order.shippingInfo.city}</span>}
                {order.shippingInfo?.carrier && <span>Paquetería: {order.shippingInfo.carrier}</span>}
                {order.shippingInfo?.tracking && (
                  <span>
                    Guía: <span className="font-mono text-foreground">{order.shippingInfo.tracking}</span>
                  </span>
                )}
                {order.notes && <span>Notas: {order.notes}</span>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function OrderActions({ order, balance, pickup }: { order: Order; balance: number; pickup: boolean }) {
  const setOrderStatus = useErp((s) => s.setOrderStatus);
  const canCancel = useCanCancelOrders();
  if (order.status === "cancelado" || order.status === "entregado") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {balance > 0 && <PaymentDialog order={order} balance={balance} />}
      {order.status === "pagado" && !pickup && <ShipDialog order={order} />}
      {(order.status === "enviado" || (order.status === "pagado" && pickup)) && (
        <Button
          size="sm"
          onClick={() => {
            setOrderStatus(order.id, "entregado")
              .then(() => toast.success(`${order.folio} marcado como entregado`))
              .catch((e) => toast.error(errorMessage(e)));
          }}
        >
          <PackageCheck /> Marcar entregado
        </Button>
      )}
      {canCancel && <CancelDialog order={order} />}
    </div>
  );
}

function PaymentDialog({ order, balance }: { order: Order; balance: number }) {
  const addPayment = useErp((s) => s.addPayment);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState<PaymentMethod>("transferencia");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setAmount(balance);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <CircleDollarSign /> Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            Saldo pendiente de {order.folio}: {mxn(balance)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Monto</Label>
            <Input type="number" value={amount || ""} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Método</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={amount <= 0}
            onClick={() => {
              const value = Math.min(amount, balance);
              addPayment(order.id, { amount: value, method, note: value >= balance ? "Liquidación" : "Abono" })
                .then(() => {
                  toast.success(`Pago de ${mxn(value)} registrado`);
                  setOpen(false);
                })
                .catch((e) => toast.error(errorMessage(e)));
            }}
          >
            <Check /> Guardar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShipDialog({ order }: { order: Order }) {
  const setOrderStatus = useErp((s) => s.setOrderStatus);
  const configured = useErp((s) => s.sales.carriers);
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState(order.shippingInfo?.carrier ?? configured[0] ?? "");
  // La paquetería del pedido puede haberse quitado de la configuración.
  const carriers = carrier && !configured.includes(carrier) ? [carrier, ...configured] : configured;
  const [tracking, setTracking] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Truck /> Enviar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar envío</DialogTitle>
          <DialogDescription>Captura la guía para compartirla con el cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Paquetería</Label>
            {carriers.length > 0 ? (
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Nombre de la paquetería" />
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Número de guía</Label>
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ej. 7712345678" />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              setOrderStatus(order.id, "enviado", { carrier: carrier.trim() || undefined, tracking: tracking.trim() || undefined })
                .then(() => {
                  toast.success(carrier.trim() ? `${order.folio} enviado por ${carrier.trim()}` : `${order.folio} marcado como enviado`);
                  setOpen(false);
                })
                .catch((e) => toast.error(errorMessage(e)));
            }}
          >
            <Truck /> Marcar como enviado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ order }: { order: Order }) {
  const setOrderStatus = useErp((s) => s.setOrderStatus);
  const branchName = useBranchName();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Ban /> Cancelar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>¿Cancelar {order.folio}?</DialogTitle>
          <DialogDescription>
            Las {order.items.reduce((a, it) => a + it.qty, 0)} piezas regresan automáticamente al inventario de {branchName(order.branch)}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            No, conservar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setOrderStatus(order.id, "cancelado")
                .then(() => {
                  toast.success(`${order.folio} cancelado · stock devuelto`);
                  setOpen(false);
                })
                .catch((e) => toast.error(errorMessage(e)));
            }}
          >
            Sí, cancelar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong ? "font-semibold" : "text-muted-foreground", className)}>
      <span>{label}</span>
      <span className={cn("tabular", !strong && "text-foreground", className)}>{value}</span>
    </div>
  );
}
