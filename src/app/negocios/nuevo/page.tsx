"use client";

import { Check, Loader2, Store, UtensilsCrossed, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KIND_LABEL } from "@/lib/constants";
import { errorMessage } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import type { BusinessKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useOwner } from "../_components/owner-shell";

type Step = "giro" | "datos" | "enviado";

const KINDS: { kind: BusinessKind; icon: LucideIcon; title: string; text: string; features: string[] }[] = [
  {
    kind: "boutique",
    icon: Store,
    title: "Boutique / tienda",
    text: "Ropa, calzado y accesorios con tallas y colores.",
    features: ["Punto de venta", "Inventario por talla", "Pedidos en línea", "Mayoreo", "Clientes"],
  },
  {
    kind: "restaurante",
    icon: UtensilsCrossed,
    title: "Restaurante / cafetería",
    text: "Tus clientes piden desde la mesa escaneando un QR.",
    features: ["Menú por QR", "Caja", "Cocina", "Mesas en vivo", "Finanzas y reportes"],
  },
];

const ACCENTS = ["#e0b252", "#8fa7ff", "#6fcf97", "#ff8a80", "#c792ea"];

const STEPS: [Step, string][] = [
  ["giro", "1 · Giro"],
  ["datos", "2 · Datos"],
  ["enviado", "3 · Revisión"],
];

export default function NuevoNegocioPage() {
  const { reload } = useOwner();
  const [step, setStep] = useState<Step>("giro");
  const [kind, setKind] = useState<BusinessKind | null>(null);
  const [form, setForm] = useState({ name: "", city: "", address: "", phone: "", tables: "8", accent: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ name: string; kind: BusinessKind; tables: number } | null>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const resto = kind === "restaurante";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    const tables = resto ? Math.round(Number(form.tables) || 0) : 0;
    // La base descarta lo vacío; el logo se sube después en Configuración.
    const profile = Object.fromEntries(
      Object.entries({ city: form.city, address: form.address, phone: form.phone, accentColor: form.accent })
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    );
    const { error } = await supabase().rpc("create_business", { p_name: form.name.trim(), p_kind: kind, p_profile: profile, p_tables: tables });
    setBusy(false);
    if (error) return void toast.error(errorMessage(error));
    setSent({ name: form.name.trim(), kind, tables });
    setStep("enviado");
    void reload();
  };

  const again = () => {
    setForm({ name: "", city: "", address: "", phone: "", tables: "8", accent: "" });
    setKind(null);
    setSent(null);
    setStep("giro");
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium" aria-label="Pasos">
        {STEPS.map(([id, label], i) => (
          <span key={id} className="contents">
            {i > 0 && <span className="text-muted-foreground">—</span>}
            <span
              aria-current={step === id ? "step" : undefined}
              className={cn("rounded-full px-3 py-1 ring-1", step === id ? "bg-gold/15 text-gold ring-gold/35" : "text-muted-foreground ring-border")}
            >
              {STEPS.findIndex(([s]) => s === step) > i ? "✓ " + label.slice(4) : label}
            </span>
          </span>
        ))}
      </div>

      {step === "giro" && (
        <>
          <PageHeader title="¿Qué tipo de negocio es?" description="El giro define su panel y sus módulos. No se puede cambiar después." />
          <div className="grid gap-5 md:grid-cols-2" role="radiogroup" aria-label="Giro del negocio">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={kind === k.kind}
                onClick={() => setKind(k.kind)}
                className={cn(
                  "flex flex-col gap-4 rounded-2xl bg-card bg-(image:--glass-sheen) p-6 text-left shadow-(--glass-shadow) ring-1 ring-(--glass-edge) transition focus-visible:outline-2 focus-visible:outline-ring",
                  kind === k.kind && "ring-2 ring-gold",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-12 place-items-center rounded-2xl bg-gold/15 text-gold">
                    <k.icon className="size-6" />
                  </span>
                  <span className={cn("grid size-6 place-items-center rounded-full ring-1 ring-border", kind === k.kind && "bg-gold text-gold-foreground ring-gold")}>
                    {kind === k.kind && <Check className="size-4" />}
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold">{k.title}</h2>
                  <p className="text-sm text-muted-foreground">{k.text}</p>
                </div>
                <ul className="flex flex-wrap gap-2 text-xs">
                  {k.features.map((f) => (
                    <li key={f} className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button asChild variant="outline">
              <Link href="/negocios">Cancelar</Link>
            </Button>
            <Button disabled={!kind} onClick={() => setStep("datos")}>
              Continuar
            </Button>
          </div>
        </>
      )}

      {step === "datos" && kind && (
        <form onSubmit={submit} className="grid gap-6">
          <PageHeader
            title={resto ? "Datos de tu restaurante o cafetería" : "Datos de tu boutique"}
            description={resto ? "Con esto lo revisamos y preparamos su menú público." : "Con esto lo revisamos y preparamos tu panel."}
          />
          <Card className="grid gap-4 px-5 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="name">Nombre del negocio</Label>
              <Input id="name" required maxLength={80} autoComplete="organization" value={form.name} onChange={set("name")} placeholder={resto ? "Ej. Café Aurora" : "Ej. Boutique Marea"} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="city">Ciudad</Label>
              <Input id="city" autoComplete="address-level2" value={form.city} onChange={set("city")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Teléfono de contacto</Label>
              <Input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" autoComplete="street-address" value={form.address} onChange={set("address")} />
            </div>
            {resto && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="tables">¿Cuántas mesas tienes?</Label>
                <Input id="tables" type="number" min={0} max={200} inputMode="numeric" className="w-32" value={form.tables} onChange={set("tables")} />
                <p className="text-xs text-muted-foreground">Creamos un QR por mesa; luego puedes agregar, renombrar o desactivar.</p>
              </div>
            )}
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Color de acento</legend>
              <div className="flex gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={form.accent === c}
                    onClick={() => setForm((f) => ({ ...f, accent: f.accent === c ? "" : c }))}
                    className={cn("size-8 rounded-full ring-offset-2 ring-offset-background", form.accent === c && "ring-2 ring-foreground")}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </fieldset>
          </Card>
          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("giro")}>
              Atrás
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Enviar a revisión
            </Button>
          </div>
        </form>
      )}

      {step === "enviado" && sent && (
        <Card className="items-center gap-5 px-6 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-gold/15 text-gold">
            <Check className="size-7" />
          </span>
          <h1 className="font-display text-3xl font-bold">{sent.name} está en revisión</h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            Recibimos tu solicitud y la estamos revisando. Ten paciencia: en cuanto confirmemos el negocio, su card se activa en &quot;Mis negocios&quot; y
            empieza tu prueba.
          </p>
          <dl className="grid w-full max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-left text-sm">
            <dt className="text-muted-foreground">Giro</dt>
            <dd className="text-right font-medium">{KIND_LABEL[sent.kind]}</dd>
            {sent.kind === "restaurante" && (
              <>
                <dt className="text-muted-foreground">Mesas</dt>
                <dd className="text-right font-medium">{sent.tables}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Estado</dt>
            <dd className="text-right font-medium">En revisión</dd>
          </dl>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/negocios">Ir a Mis negocios</Link>
            </Button>
            <Button variant="outline" onClick={again}>
              Agregar otro negocio
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
