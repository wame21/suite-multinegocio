"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/erp";
import { QrImage } from "@/components/restaurante/qr";
import { tableLabel } from "@/components/restaurante/ui";
import { Button } from "@/components/ui/button";
import { listTables, type DiningTable } from "@/lib/restaurant";
import { errorMessage, useBusinessName } from "@/lib/store";

/** Hoja imprimible: un QR por mesa activa. El menú lateral y la barra se ocultan al imprimir. */
export default function HojaQrPage() {
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const business = useBusinessName();
  useEffect(() => {
    listTables().then((t) => setTables(t.filter((x) => x.active))).catch((e) => toast.error(errorMessage(e)));
  }, []);

  return (
    <>
      <PageHeader
        title="Hoja de QR"
        description="Imprime y recorta: cada QR lleva a tu menú con su mesa ya elegida."
        actions={<Button onClick={() => window.print()}><Printer /> Imprimir</Button>}
      />
      {tables === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="grid grid-cols-2 gap-6 print:gap-4 md:grid-cols-3">
          {tables.map((t) => (
            <div key={t.id} className="flex break-inside-avoid flex-col items-center gap-3 rounded-2xl border border-dashed p-5 text-center">
              <div className="font-display text-lg font-bold uppercase tracking-[0.08em]">{business}</div>
              <QrImage token={t.qrToken} label={`mesa ${t.name}`} className="w-full max-w-48" />
              <p className="text-sm">Escanea, pide y paga desde tu celular</p>
              <div className="text-2xl font-semibold">{tableLabel(t.name)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
