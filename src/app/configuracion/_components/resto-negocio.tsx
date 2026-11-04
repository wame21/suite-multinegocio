"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage, useErp } from "@/lib/store";
import { Field, SaveBar } from "./fields";
import { patchProfile, readProfile } from "./resto-data";

const KEYS = ["phone", "city", "address"] as const;
type Form = { name: string; phone: string; city: string; address: string };

export function RestoNegocioSection() {
  const business = useErp((s) => s.business);
  const saveBusiness = useErp((s) => s.saveBusiness);
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    readProfile()
      .then((p) => {
        const f: Form = { name: business?.name ?? "", phone: String(p.phone ?? ""), city: String(p.city ?? ""), address: String(p.address ?? "") };
        setSaved(f);
        setForm(f);
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [business?.name]);

  if (!form || !saved || !business) return <p className="py-6 text-sm text-muted-foreground">Cargando…</p>;
  const errors = form.name.trim() ? [] : ["Escribe el nombre del negocio"];
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const next = { ...form, name: form.name.trim() };
      // update_business exige también los prefijos de folio: se reenvían los que ya tiene
      if (next.name !== saved.name) await saveBusiness({ name: next.name, orderPrefix: business.orderPrefix, quotePrefix: business.quotePrefix });
      await patchProfile(Object.fromEntries(KEYS.map((k) => [k, next[k].trim()])));
      setSaved(next);
      setForm(next);
      toast.success("Datos del negocio guardados");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Negocio</CardTitle>
        <CardDescription>Los datos de tu restaurante o cafetería.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre del negocio" className="sm:col-span-2"><Input value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Teléfono"><Input inputMode="tel" value={form.phone} maxLength={30} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Ciudad"><Input value={form.city} maxLength={60} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Dirección" className="sm:col-span-2"><Input value={form.address} maxLength={120} onChange={(e) => set("address", e.target.value)} /></Field>
        </div>
        <SaveBar errors={errors} dirty={dirty} saving={saving} onSave={() => void save()} />
      </CardContent>
    </Card>
  );
}
