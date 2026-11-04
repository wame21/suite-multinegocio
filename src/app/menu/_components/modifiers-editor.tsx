"use client";

import { Copy, Plus, X } from "lucide-react";
import { useState } from "react";
import { cloneGroups, newGroup, newOption, ruleLabel, validateGroups } from "@/components/restaurante/modifiers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { MenuItem, ModifierGroup } from "@/lib/restaurant";

/** Editor de los grupos de modificadores de un platillo (D12). Edita una copia: `onDone` devuelve los grupos válidos. */
export function ModifiersEditor({
  name,
  groups: initial,
  others,
  onDone,
  onBack,
}: {
  name: string;
  groups: ModifierGroup[];
  /** Otros platillos con grupos, para copiarlos. */
  others: MenuItem[];
  onDone: (groups: ModifierGroup[]) => void;
  onBack: () => void;
}) {
  const [groups, setGroups] = useState(initial);
  const [shown, setShown] = useState(false);
  const errors = validateGroups(groups);

  const patch = (i: number, p: Partial<ModifierGroup>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const patchOption = (i: number, k: number, p: Partial<ModifierGroup["opciones"][number]>) =>
    patch(i, { opciones: groups[i].opciones.map((o, j) => (j === k ? { ...o, ...p } : o)) });
  const options = groups.reduce((n, g) => n + g.opciones.length, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Tú decides qué puede elegir el comensal en <b className="text-foreground">{name || "este platillo"}</b> y cuánto cuesta cada opción.
          {" "}{groups.length} {groups.length === 1 ? "grupo" : "grupos"} · {options} {options === 1 ? "opción" : "opciones"}
        </p>
        <div className="flex flex-wrap gap-2">
          {others.length > 0 && (
            <Select value="" onValueChange={(id) => setGroups((gs) => [...gs, ...cloneGroups(others.find((o) => o.id === id)!.modifiers)])}>
              <SelectTrigger className="h-9 w-56" aria-label="Copiar grupos de otro producto">
                <Copy className="size-4" /> <SelectValue placeholder="Copiar grupos de otro producto" />
              </SelectTrigger>
              <SelectContent>
                {others.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name} · {o.modifiers.length} {o.modifiers.length === 1 ? "grupo" : "grupos"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={() => setGroups((gs) => [...gs, newGroup()])}><Plus /> Agregar grupo</Button>
        </div>
      </div>

      {groups.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Sin modificadores: el comensal pide el platillo tal cual.</p>}

      {groups.map((g, i) => (
        <div key={g.id} className="grid gap-3 rounded-2xl border p-3">
          <div className="flex items-center gap-2">
            <Input aria-label="Nombre del grupo" value={g.nombre} maxLength={40} placeholder="Ej. Tipo de leche" onChange={(e) => patch(i, { nombre: e.target.value })} />
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{ruleLabel(g)}</span>
            <Button size="icon" variant="ghost" aria-label={`Quitar grupo ${g.nombre || i + 1}`} onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}><X /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><Switch checked={g.obligatorio} onCheckedChange={(v) => patch(i, { obligatorio: v })} /> Obligatorio</label>
            <label className="flex items-center gap-2">Elige de
              <Input type="number" min={0} className="h-8 w-16" value={g.min} onChange={(e) => patch(i, { min: Number(e.target.value) })} />
              a
              <Input type="number" min={1} className="h-8 w-16" value={g.max} onChange={(e) => patch(i, { max: Number(e.target.value) })} />
              opciones
            </label>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-[1fr_6rem_4.5rem_2rem] gap-2 text-xs text-muted-foreground"><span>Opción</span><span>Precio extra</span><span>Disponible</span><span /></div>
            {g.opciones.map((o, k) => (
              <div key={o.id} className="grid grid-cols-[1fr_6rem_4.5rem_2rem] items-center gap-2">
                <Input aria-label="Nombre de la opción" value={o.nombre} maxLength={40} onChange={(e) => patchOption(i, k, { nombre: e.target.value })} />
                <Input aria-label="Precio extra" type="number" min={0} step="0.5" value={o.precio_extra} onChange={(e) => patchOption(i, k, { precio_extra: Number(e.target.value) })} />
                <Switch aria-label="Disponible" checked={o.disponible} onCheckedChange={(v) => patchOption(i, k, { disponible: v })} />
                <Button size="icon" variant="ghost" aria-label="Quitar opción" onClick={() => patch(i, { opciones: g.opciones.filter((_, j) => j !== k) })}><X /></Button>
              </div>
            ))}
            <div><Button size="sm" variant="ghost" onClick={() => patch(i, { opciones: [...g.opciones, newOption()] })}><Plus /> Agregar opción</Button></div>
          </div>
        </div>
      ))}

      {shown && errors.length > 0 && (
        <ul className="grid gap-1 text-xs text-destructive" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <p className="text-xs text-muted-foreground">El precio final se recalcula en el servidor; el comensal no puede alterarlo.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>Descartar</Button>
        <Button onClick={() => (errors.length ? setShown(true) : onDone(groups))}>Listo</Button>
      </div>
    </div>
  );
}
