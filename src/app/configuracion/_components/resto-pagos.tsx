"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getRestaurantSettings, type PayMethod, type RestaurantSettings } from "@/lib/restaurant";
import { errorMessage } from "@/lib/store";
import { Field, SaveBar } from "./fields";
import { METHOD_INFO, validatePagos } from "./resto";
import { patchRestaurant } from "./resto-data";

type Form = Pick<RestaurantSettings, "cardAtTable" | "methods" | "transfer" | "folioPrefix">;
const pick = (s: RestaurantSettings): Form => ({ cardAtTable: s.cardAtTable, methods: s.methods, transfer: s.transfer, folioPrefix: s.folioPrefix });

export function RestoPagosSection() {
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRestaurantSettings()
      .then((s) => {
        setSaved(pick(s));
        setForm(pick(s));
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  if (!form || !saved) return <p className="py-6 text-sm text-muted-foreground">Cargando…</p>;
  const errors = validatePagos(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const toggleMethod = (m: PayMethod, on: boolean) => setForm({ ...form, methods: on ? [...form.methods, m] : form.methods.filter((x) => x !== m) });
  const setTransfer = (k: keyof Form["transfer"], v: string) => setForm({ ...form, transfer: { ...form.transfer, [k]: v } });

  const save = async () => {
    setSaving(true);
    try {
      const next = { ...form, folioPrefix: form.folioPrefix.trim().toUpperCase(), transfer: Object.fromEntries(Object.entries(form.transfer).map(([k, v]) => [k, v.trim()])) as Form["transfer"] };
      await patchRestaurant(next);
      setSaved(next);
      setForm(next);
      toast.success("Pagos guardados");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Cobro con tarjeta</CardTitle>
          <CardDescription>Si lo apagas, a quien elija tarjeta le pedimos pasar a caja.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-center gap-3 text-sm font-medium">
            <Switch checked={form.cardAtTable} onCheckedChange={(v) => setForm({ ...form, cardAtTable: v })} /> Un mesero lleva la terminal a la mesa
          </label>
          <p className="text-xs text-muted-foreground">
            <b>Encendido:</b> «Un mesero llevará la terminal a tu mesa». Lo confirma el mesero en Mesas en vivo.<br />
            <b>Apagado:</b> «Pasa a caja para pagar con tarjeta». Lo confirma el cajero en Caja.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Métodos que aceptas</CardTitle>
          <CardDescription>Los pedidos entran a cocina solo después de confirmar el pago.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {(Object.keys(METHOD_INFO) as PayMethod[]).map((m) => (
            <label key={m} className="flex items-center gap-3 text-sm">
              <Switch checked={form.methods.includes(m)} onCheckedChange={(v) => toggleMethod(m, v)} />
              <span><b>{METHOD_INFO[m].label}</b> <span className="text-muted-foreground">{METHOD_INFO[m].hint}</span></span>
            </label>
          ))}
          {form.methods.includes("transferencia") && (
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <Field label="CLABE" className="sm:col-span-2"><Input inputMode="numeric" maxLength={18} value={form.transfer.clabe} onChange={(e) => setTransfer("clabe", e.target.value.replace(/\D/g, ""))} /></Field>
              <Field label="Banco"><Input value={form.transfer.bank} maxLength={60} onChange={(e) => setTransfer("bank", e.target.value)} /></Field>
              <Field label="Titular"><Input value={form.transfer.holder} maxLength={80} onChange={(e) => setTransfer("holder", e.target.value)} /></Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Prefijo de folio" hint="Los folios se ven como A-1, A-2… (1 a 4 letras). Aplica a los pedidos nuevos.">
            <Input className="w-28" maxLength={4} value={form.folioPrefix} onChange={(e) => setForm({ ...form, folioPrefix: e.target.value })} />
          </Field>
          <SaveBar errors={errors} dirty={dirty} saving={saving} onSave={() => void save()} />
        </CardContent>
      </Card>
    </div>
  );
}
