import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { mxn, mxnCents } from "@/lib/format";
import type { TableOrder, TableOrderStatus } from "@/lib/restaurant";
import { cn } from "@/lib/utils";
import { STATUS_NAME } from "./orders";

const PILL: Record<TableOrderStatus, string> = {
  por_pagar: "bg-warning/15 text-warning ring-warning/30",
  pagado: "bg-gold/15 text-gold ring-gold/35",
  en_preparacion: "bg-ch-web/12 text-ch-web ring-ch-web/30",
  terminado: "bg-success/12 text-success ring-success/30",
  entregado: "bg-muted text-muted-foreground ring-border",
  cancelado: "bg-muted text-muted-foreground ring-border line-through",
};

export function StatusPill({ status }: { status: TableOrderStatus }) {
  return (
    <Badge variant="outline" className={cn("border-0 ring-1", PILL[status])}>
      {STATUS_NAME[status]}
    </Badge>
  );
}

/** Renglones del pedido con sus opciones y notas. `prices` agrega el importe de cada renglón (Caja). */
export function OrderLines({ order, prices, large }: { order: TableOrder; prices?: boolean; large?: boolean }) {
  return (
    <div className="grid gap-2">
      <ul className={cn("grid gap-2", large ? "text-base" : "text-sm")}>
        {order.items.map((l, i) => (
          <li key={i}>
            <div className="flex justify-between gap-3">
              <span>
                <b className="tabular">{l.qty}×</b> {l.name}
              </span>
              {prices && <span className="tabular text-muted-foreground">{mxnCents(l.lineTotal)}</span>}
            </div>
            {l.options.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {l.options.map((o) => (o.extra ? `${o.name} +${mxn(o.extra)}` : o.name)).join(" · ")}
              </div>
            )}
            {l.note && <div className="text-xs text-gold">Nota: {l.note}</div>}
          </li>
        ))}
      </ul>
      {order.note && <p className="text-xs text-gold">Nota del pedido: «{order.note}»</p>}
    </div>
  );
}

/** Mientras cargan los pedidos (o si falla la carga) muestra el aviso en lugar de las pantallas. */
export function LiveGate({ live, children }: { live: { loaded: boolean; error: string | null }; children: ReactNode }) {
  if (live.error) return <p className="py-10 text-center text-sm text-destructive">No se pudo cargar: {live.error}</p>;
  if (!live.loaded) return <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>;
  return <>{children}</>;
}

export const tableNames = (tables: { id: string; name: string }[]) => new Map(tables.map((t) => [t.id, t.name]));

/** «Mesa 4»: los nombres sembrados ya dicen "Mesa", los que da el dueño ("T1") no. */
export const tableLabel = (name: string | undefined) => (!name ? "Mesa —" : /^mesa\b/i.test(name) ? name : `Mesa ${name}`);
