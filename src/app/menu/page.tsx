"use client";

import { Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/erp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mxnCents } from "@/lib/format";
import { getMenuItemCosts, listMenu, saveCategory, saveMenuItem, type MenuCategory, type MenuItem } from "@/lib/restaurant";
import { errorMessage } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ItemEditor } from "./_components/item-editor";

export default function MenuPage() {
  const [data, setData] = useState<{ categories: MenuCategory[]; items: MenuItem[]; costs: Record<string, number> } | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);
  const [catDialog, setCatDialog] = useState<MenuCategory | "new" | null>(null);

  const load = useCallback(
    () =>
      Promise.all([listMenu(), getMenuItemCosts()])
        .then(([menu, costs]) => setData({ ...menu, costs }))
        .catch((e) => toast.error(errorMessage(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return (<><PageHeader title="Menú" /><p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p></>);

  const cat = data.categories.find((c) => c.id === catId) ?? data.categories[0];
  const items = data.items.filter((i) => i.categoryId === cat?.id);
  const toggle = async (item: MenuItem) => {
    try {
      await saveMenuItem({ ...item, available: !item.available });
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Menú"
        description="Lo que tus comensales ven al escanear el QR. Los cambios se publican al guardar."
        actions={<Button disabled={!cat} onClick={() => setEditing("new")}><Plus /> Nuevo producto</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="content-start gap-1 p-2">
          {data.categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCatId(c.id)}
              className={cn("flex h-10 items-center justify-between rounded-xl px-3 text-sm hover:bg-muted", c.id === cat?.id && "bg-gold/10 font-semibold ring-1 ring-gold/40")}
            >
              {c.name}
              <span className="text-xs text-muted-foreground tabular">{data.items.filter((i) => i.categoryId === c.id).length}</span>
            </button>
          ))}
          <Button variant="ghost" className="justify-start" onClick={() => setCatDialog("new")}><Plus /> Nueva categoría</Button>
        </Card>

        <Card className="py-0">
          {!cat ? (
            <EmptyState icon={Plus} title="Empieza con una categoría">Crea «Cafés», «Desayunos»… y luego agrega sus productos.</EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="font-semibold">{cat.name}</h2>
                <Button size="sm" variant="ghost" onClick={() => setCatDialog(cat)}><Pencil /> Renombrar</Button>
              </div>
              {items.length === 0 ? (
                <EmptyState icon={Plus} title="Sin productos en esta categoría" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Producto</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Costo</TableHead>
                      <TableHead className="pr-4 text-right">Disponible</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i) => (
                      <TableRow key={i.id} className="cursor-pointer" onClick={() => setEditing(i)}>
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-3">
                            {i.photo && (
                              // eslint-disable-next-line @next/next/no-img-element -- fotos por dirección externa
                              <img src={i.photo} alt="" className="size-10 rounded-lg object-cover" />
                            )}
                            <div>
                              <div className="font-medium">{i.name}</div>
                              <div className="text-xs text-muted-foreground">{i.description}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular">{mxnCents(i.price)}</TableCell>
                        <TableCell className="hidden text-right tabular text-muted-foreground sm:table-cell">{mxnCents(data.costs[i.id] ?? 0)}</TableCell>
                        <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <Switch aria-label={`${i.name} disponible`} checked={i.available} onCheckedChange={() => void toggle(i)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </Card>
      </div>

      {editing && cat && (
        <ItemEditor
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? null : editing}
          categoryId={cat.id}
          categories={data.categories}
          items={data.items}
          cost={editing === "new" ? 0 : (data.costs[editing.id] ?? 0)}
          nextSort={Math.max(0, ...data.items.map((i) => i.sort)) + 1}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
      {catDialog && (
        <CategoryDialog
          category={catDialog === "new" ? null : catDialog}
          nextSort={Math.max(0, ...data.categories.map((c) => c.sort)) + 1}
          onClose={() => setCatDialog(null)}
          onSaved={(c) => { setCatDialog(null); setCatId(c.id); void load(); }}
        />
      )}
    </>
  );
}

function CategoryDialog({ category, nextSort, onClose, onSaved }: { category: MenuCategory | null; nextSort: number; onClose: () => void; onSaved: (c: MenuCategory) => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast.error("Escribe el nombre de la categoría");
    setSaving(true);
    try {
      onSaved(await saveCategory({ id: category?.id, name: name.trim(), sort: category?.sort ?? nextSort }));
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Renombrar categoría" : "Nueva categoría"}</DialogTitle>
          <DialogDescription>Así la ve el comensal en el menú.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Nombre de la categoría" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving} onClick={() => void save()}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
