"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getRestaurantSettings } from "@/lib/restaurant";
import { errorMessage, useErp } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Field, SaveBar } from "./fields";
import { validateMenuPublico, WELCOME_MAX } from "./resto";
import { patchProfile, patchRestaurant, readProfile } from "./resto-data";

const ACCENTS = ["#b8892b", "#0f766e", "#1d4ed8", "#7c3aed", "#be123c", "#c2410c", "#15803d", "#334155"];
const BUCKET = "logos";
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const pathOf = (url: string | null) => url?.split(`/${BUCKET}/`)[1]?.split("?")[0];

interface Saved { welcome: string; accent: string | null }

export function RestoMenuSection() {
  const [logo, setLogo] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [form, setForm] = useState<Saved | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([readProfile(), getRestaurantSettings()])
      .then(([p, r]) => {
        const s = { welcome: r.welcome ?? "", accent: (p.accentColor as string | null) ?? null };
        setLogo((p.logoUrl as string | null) ?? null);
        setSaved(s);
        setForm(s);
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  if (!form || !saved) return <p className="py-6 text-sm text-muted-foreground">Cargando…</p>;
  const errors = validateMenuPublico(form.welcome, form.accent);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    try {
      const next = { ...form, welcome: form.welcome.trim() };
      await Promise.all([patchRestaurant({ welcome: next.welcome }), patchProfile({ accentColor: next.accent })]);
      setSaved(next);
      setForm(next);
      toast.success("Menú público guardado");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removeFile = async (url: string | null) => {
    const path = pathOf(url);
    if (path) await supabase().storage.from(BUCKET).remove([path]).catch(() => {});
  };

  const onLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = EXT[file.type];
    if (!ext) return toast.error("El logo debe ser PNG, JPG o WebP");
    if (file.size > 2 * 1024 * 1024) return toast.error("El logo no puede pesar más de 2 MB");
    setBusy(true);
    try {
      const path = `${useErp.getState().profile?.businessId}/logo-${Date.now()}.${ext}`;
      const up = await supabase().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const url = supabase().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      try {
        await patchProfile({ logoUrl: url });
      } catch (err) {
        await removeFile(url);
        throw err;
      }
      await removeFile(logo);
      setLogo(url);
      toast.success("Logo actualizado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await patchProfile({ logoUrl: null });
      await removeFile(logo);
      setLogo(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Menú público</CardTitle>
        <CardDescription>Cómo se ve tu menú cuando el comensal escanea el QR.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-20 place-items-center overflow-hidden rounded-2xl border bg-muted/50">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo público del negocio
              <img src={logo} alt="Logo del negocio" className="size-full object-contain" />
            ) : (
              <ImagePlus className="size-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onLogo(e)} />
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {logo ? "Cambiar logo" : "Subir logo"}
            </Button>
            {logo && <Button variant="ghost" disabled={busy} onClick={() => void onRemove()}><Trash2 /> Quitar</Button>}
          </div>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Color</span>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={form.accent === c}
                onClick={() => setForm({ ...form, accent: c })}
                className={cn("size-8 rounded-full ring-offset-2 ring-offset-background", form.accent === c && "ring-2 ring-foreground")}
                style={{ background: c }}
              />
            ))}
            {form.accent && <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, accent: null })}>Quitar color</Button>}
          </div>
        </div>

        <Field label="Mensaje de bienvenida" hint={`${form.welcome.length}/${WELCOME_MAX} · lo ve el comensal al abrir el menú`}>
          <Textarea rows={3} value={form.welcome} onChange={(e) => setForm({ ...form, welcome: e.target.value })} placeholder="Bienvenido a nuestra mesa. Pide desde tu celular y te lo llevamos." />
        </Field>
        <SaveBar errors={errors} dirty={dirty} saving={saving} onSave={() => void save()} />
      </CardContent>
    </Card>
  );
}
