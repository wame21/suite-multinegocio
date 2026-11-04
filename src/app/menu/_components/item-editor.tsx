"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ruleLabel } from "@/components/restaurante/modifiers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { pct } from "@/lib/format";
import { saveMenuItem, type MenuCategory, type MenuItem, type ModifierGroup } from "@/lib/restaurant";
import { errorMessage } from "@/lib/store";
import { ModifiersEditor } from "./modifiers-editor";

interface Form {
  name: string;
  description: string;
  categoryId: string;
  price: number;
  cost: number;
  photo: string;
  available: boolean;
  modifiers: ModifierGroup[];
}

export function validateItem(f: Form): string[] {
  const errors: string[] = [];
  if (!f.name.trim()) errors.push("Escribe el nombre del producto");
  if (!f.categoryId) errors.push("Elige una categoría");
  if (!Number.isFinite(f.price) || f.price < 0) errors.push("El precio no puede ser negativo");
  if (!Number.isFinite(f.cost) || f.cost < 0) errors.push("El costo no puede ser negativo");
  if (f.photo.trim() && !/^https:\/\/\S+$/i.test(f.photo.trim())) errors.push("La foto debe ser una dirección https");
  if (f.photo.trim().length > 500) errors.push("La dirección de la foto es demasiado larga");
  return errors;
}

/** Editor de producto (D07) con los modificadores (D12) en una segunda vista. `item` vacío = producto nuevo. */
export function ItemEditor({
  item,
  categoryId,
  categories,
  items,
  cost,
  nextSort,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categoryId: string;
  categories: MenuCategory[];
  items: MenuItem[];
  cost: number;
  nextSort: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>({
    name: item?.name ?? "",
    description: item?.description ?? "",
    categoryId: item?.categoryId ?? categoryId,
    price: item?.price ?? 0,
    cost,
    photo: item?.photo ?? "",
    available: item?.available ?? true,
    modifiers: item?.modifiers ?? [],
  });
  const [view, setView] = useState<"form" | "mods">("form");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = validateItem(form);
  const margin = form.price > 0 ? (form.price - form.cost) / form.price : 0;

  const save = async () => {
    if (errors.length) return toast.error(errors[0]);
    setSaving(true);
    try {
      await saveMenuItem(
        {
          id: item?.id,
          categoryId: form.categoryId,
          name: form.name.trim(),
          description: form.description.trim(),
          price: form.price,
          photo: form.photo.trim() || null,
          available: form.available,
          sort: item?.sort ?? nextSort,
          modifiers: form.modifiers,
        },
        form.cost,
      );
      toast.success(item ? "Producto guardado" : "Producto agregado");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{view === "mods" ? "Modificadores" : item ? "Editar producto" : "Nuevo producto"}</DialogTitle>
          <DialogDescription>{view === "mods" ? "Opciones que el comensal puede elegir en este producto." : "Lo que tus comensales ven al escanear el QR. Los cambios se publican al guardar."}</DialogDescription>
        </DialogHeader>

        {view === "mods" ? (
          <ModifiersEditor
            name={form.name}
            groups={form.modifiers}
            others={items.filter((i) => i.id !== item?.id && i.modifiers.length > 0)}
            onBack={() => setView("form")}
            onDone={(groups) => { set("modifiers", groups); setView("form"); }}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="p-nombre">Nombre</Label><Input id="p-nombre" value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="p-desc">Descripción</Label><Textarea id="p-desc" rows={2} maxLength={300} value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
              <div className="grid gap-1.5">
                <Label>Categoría</Label>
                <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-foto">Foto (dirección de la imagen)</Label>
                <Input id="p-foto" inputMode="url" placeholder="https://…" value={form.photo} onChange={(e) => set("photo", e.target.value)} />
              </div>
              <div className="grid gap-1.5"><Label htmlFor="p-precio">Precio</Label><Input id="p-precio" type="number" min={0} step="0.5" value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-costo">Costo</Label>
                <Input id="p-costo" type="number" min={0} step="0.5" value={form.cost} onChange={(e) => set("cost", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">Margen {pct(margin)} · el costo solo lo ve el dueño</span>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={form.available} onCheckedChange={(v) => set("available", v)} /> Disponible hoy</label>
            </div>

            <div className="grid gap-2 rounded-2xl border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Modificadores</span>
                <Button size="sm" variant="outline" onClick={() => setView("mods")}>{form.modifiers.length ? "Editar grupos" : "Agregar grupos"}</Button>
              </div>
              {form.modifiers.length === 0 && <p className="text-xs text-muted-foreground">Sin grupos: el comensal pide el producto tal cual.</p>}
              {form.modifiers.map((g) => (
                <div key={g.id} className="text-sm">
                  <b>{g.nombre}</b> <span className="text-xs text-muted-foreground">{ruleLabel(g)}</span>
                  <div className="text-xs text-muted-foreground">{g.opciones.map((o) => (o.precio_extra ? `${o.nombre} +$${o.precio_extra}` : o.nombre)).join(" · ")}</div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button disabled={saving} onClick={() => void save()}>Guardar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
