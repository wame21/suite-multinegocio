"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Dirección que abre el comensal al escanear: `{origen de la app}/m/{qr_token}`. */
export const tableUrl = (token: string) => `${window.location.origin}/m/${token}`;

const qrOptions = { margin: 1, errorCorrectionLevel: "M" } as const;

export function QrImage({ token, label, className }: { token: string; label: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let off = false;
    QRCode.toDataURL(tableUrl(token), { ...qrOptions, width: 320 }).then((u) => !off && setSrc(u));
    return () => {
      off = true;
    };
  }, [token]);
  // eslint-disable-next-line @next/next/no-img-element -- data URL generado en el navegador
  return src ? <img src={src} alt={`QR de ${label}`} className={cn("aspect-square bg-white", className)} /> : <div className={cn("aspect-square animate-pulse bg-muted", className)} />;
}

/** Descarga el QR como PNG grande (para imprimirlo o mandarlo a un diseñador). */
export async function downloadQr(token: string, name: string) {
  const url = await QRCode.toDataURL(tableUrl(token), { ...qrOptions, width: 1024 });
  const a = document.createElement("a");
  a.href = url;
  a.download = `qr-mesa-${name.replace(/[^\w-]+/g, "_")}.png`;
  a.click();
}
