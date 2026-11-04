"use client";

import { Download, Pencil, Plus, Power, Printer, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/erp";
import { downloadQr, QrImage } from "@/components/restaurante/qr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteTable, listTables, regenerateTableQr, saveTable, type DiningTable } from "@/lib/restaurant";
import { errorMessage } from "@/lib/store";
import { cn } from "@/lib/utils";

const ALL = "todas";
const OFF = "desactivadas";

export default function MesasPage() {
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [filter, setFilter] = useState(ALL);
  const [editing, setEditing] = useState<DiningTable | "new" | null>(null);
  const [regen, setRegen] = useState<DiningTable | null>(null);
  const [removing, setRemoving] = useState<DiningTable | null>(null);

  const load = useCallback(() => listTables().then(setTables).catch((e) => toast.error(errorMessage(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (t: DiningTable) => setTables((list) => (list ?? []).map((x) => (x.id === t.id ? t : x)));
  const run = async (job: () => Promise<DiningTable>, done: string) => {
    try {
      replace(await job());
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (t: DiningTable) => {
    try {
      await deleteTable(t.id);
      setTables((list) => (list ?? []).filter((x) => x.id !== t.id));
      toast.success("Mesa borrada");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const areas = [...new Set((tables ?? []).filter((t) => t.active && t.area).map((t) => t.area))];
  const shown = (tables ?? []).filter((t) => (filter === OFF ? !t.active : filter === ALL ? true : t.active && t.area === filter));
  const chips = [
    [ALL, `Todas · ${tables?.length ?? 0}`],
    ...areas.map((a) => [a, `${a} · ${tables!.filter((t) => t.active && t.area === a).length}`]),
    [OFF, `Desactivadas · ${(tables ?? []).filter((t) => !t.active).length}`],
  ];

  return (
    <>
      <PageHeader
        title="Mesas y QR"
        description="Cada mesa tiene su QR. Al escanearlo, el comensal abre tu menú ya ligado a esa mesa."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/mesas/hoja"><Printer /> Imprimir todos</Link>
            </Button>
            <Button onClick={() => setEditing("new")}><Plus /> Agregar mesa</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map(([key, label]) => (
          <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} onClick={() => setFilter(key)}>{label}</Button>
        ))}
      </div>

      {tables === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : shown.length === 0 ? (
        <Card><EmptyState icon={Plus} title="Sin mesas aquí">Agrega una mesa para generar su QR.</EmptyState></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((t) => (
            <Card key={t.id} className={cn("gap-3 p-4", !t.active && "opacity-60")}>
              <QrImage token={t.qrToken} label={`mesa ${t.name}`} className="w-full rounded-xl" />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.area || "Sin área"}</div>
                </div>
                <Badge variant={t.active ? "secondary" : "outline"}>{t.active ? "Activa" : "Desactivada"}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => void downloadQr(t.qrToken, t.name)}><Download /> Descargar</Button>
                <Button size="sm" variant="outline" onClick={() => setRegen(t)}><RefreshCw /> Regenerar</Button>
                <Button size="icon" variant="ghost" aria-label={`Editar ${t.name}`} onClick={() => setEditing(t)}><Pencil /></Button>
                <Button size="icon" variant="ghost" aria-label={t.active ? `Desactivar ${t.name}` : `Activar ${t.name}`} onClick={() => void run(() => saveTable({ ...t, active: !t.active }), t.active ? "Mesa desactivada" : "Mesa activada")}>
                  <Power />
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Borrar ${t.name}`} onClick={() => setRemoving(t)}><Trash2 /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Regenerar invalida el QR impreso anterior. Desactivar una mesa muestra «Mesa no disponible» a quien la escanee.
      </p>

      {editing && (
        <TableDialog
          table={editing === "new" ? null : editing}
          nextSort={Math.max(0, ...(tables ?? []).map((t) => t.sort)) + 1}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
      <Dialog open={!!regen} onOpenChange={(o) => !o && setRegen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Regenerar el QR de la mesa {regen?.name}?</DialogTitle>
            <DialogDescription>El QR impreso anterior dejará de funcionar. Tendrás que imprimir el nuevo.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegen(null)}>Cancelar</Button>
            <Button onClick={() => { const t = regen!; setRegen(null); void run(() => regenerateTableQr(t.id), "QR nuevo generado"); }}>Sí, regenerar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar la mesa {removing?.name}?</DialogTitle>
            <DialogDescription>Su QR impreso dejará de funcionar. Si la mesa ya tiene pedidos no se puede borrar: desactívala.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { const t = removing!; setRemoving(null); void remove(t); }}>Sí, borrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TableDialog({ table, nextSort, onClose, onSaved }: { table: DiningTable | null; nextSort: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(table?.name ?? "");
  const [area, setArea] = useState(table?.area ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error("Escribe el nombre de la mesa");
    setSaving(true);
    try {
      await saveTable({ id: table?.id, name: name.trim(), area: area.trim(), active: table?.active ?? true, sort: table?.sort ?? nextSort });
      toast.success(table ? "Mesa actualizada" : "Mesa agregada");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{table ? `Editar ${table.name}` : "Agregar mesa"}</DialogTitle>
          <DialogDescription>El nombre es lo que ve el comensal y el personal; el área agrupa las mesas (Terraza, Salón…).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="mesa-nombre">Nombre</Label><Input id="mesa-nombre" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Mesa 5" /></div>
          <div className="grid gap-1.5"><Label htmlFor="mesa-area">Área</Label><Input id="mesa-area" value={area} maxLength={30} onChange={(e) => setArea(e.target.value)} placeholder="Terraza" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving} onClick={() => void save()}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
