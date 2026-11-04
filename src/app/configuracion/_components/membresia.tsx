"use client";

import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentInfo } from "@/components/payment-info";
import { fDate, mxn } from "@/lib/format";
import { daysLeft, STATE_LABELS } from "@/lib/membership";
import { useErp } from "@/lib/store";

const INCLUDED = {
  boutique: ["Panel general", "Punto de venta", "Pedidos", "Inventario", "Clientes", "Mayoreo", "Finanzas", "Reportes", "Equipo y sucursales"],
  restaurante: ["Panel general", "Menú y modificadores", "Mesas y QR", "Caja", "Cocina", "Mesas en vivo", "Finanzas", "Reportes", "Equipo"],
};

export function MembresiaSection() {
  const m = useErp((s) => s.membership);
  const kind = useErp((s) => s.kind);
  if (!m) return null;

  const ends = m.paidUntil ?? m.trialEndsAt;
  const left = daysLeft(ends);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Membresía
            <Badge variant={m.state === "gracia" ? "destructive" : "secondary"}>{STATE_LABELS[m.state]}</Badge>
          </CardTitle>
          <CardDescription>
            {ends &&
              `${left !== null && left <= 0 ? "Venció" : "Vence"} el ${fDate(ends)}${left !== null && left > 0 ? ` (${left} ${left === 1 ? "día" : "días"})` : ""}. `}
            {mxn(m.priceMonthly)} al mes con todo el sistema
            {m.paidUntil ? "." : `; al contratar se paga además el alta de ${mxn(m.priceSetup)} (pago único).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2 md:grid-cols-3">
            {INCLUDED[kind].map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Check className="size-3.5 text-gold" /> {k}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cómo pagar</CardTitle>
          <CardDescription>Haz tu transferencia y avísanos: registramos el pago y tu vencimiento se actualiza.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentInfo />
        </CardContent>
      </Card>
    </div>
  );
}
