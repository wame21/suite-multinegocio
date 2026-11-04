"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPENSE_LABEL, PAYMENT_LABEL } from "@/lib/constants";
import { mxn } from "@/lib/format";
import { errorMessage, useActiveBranches, useErp } from "@/lib/store";
import type { BranchId, ExpenseCategory, PaymentMethod } from "@/lib/types";

/** Registro de gastos compartido por boutique y restaurante; `onAdded` deja recargar listas que no vienen del store. */
export function ExpenseDialog({ onAdded }: { onAdded?: () => void }) {
  const addExpense = useErp((s) => s.addExpense);
  const branches = useActiveBranches();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    description: "",
    amount: 0,
    category: "otros" as ExpenseCategory,
    branch: "general" as BranchId | "general",
    method: "transferencia" as PaymentMethod,
  });

  const submit = () => {
    if (!f.description.trim() || f.amount <= 0) return toast.error("Concepto y monto son obligatorios");
    addExpense({
      date: new Date().toISOString(),
      description: f.description.trim(),
      amount: f.amount,
      category: f.category,
      branch: f.branch === "general" ? undefined : f.branch,
      method: f.method,
    })
      .then(() => {
        toast.success(`Gasto de ${mxn(f.amount)} registrado · utilidad recalculada`);
        setOpen(false);
        onAdded?.();
        setF({ ...f, description: "", amount: 0 });
      })
      .catch((e) => toast.error(errorMessage(e)));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-9">
          <Plus /> Registrar gasto
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar gasto</DialogTitle>
          <DialogDescription>Se descuenta de la utilidad del periodo automáticamente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Concepto</Label>
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej. Campaña Meta Ads fin de semana" />
          </div>
          <div className="grid gap-1.5">
            <Label>Monto</Label>
            <Input type="number" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: Number(e.target.value) || 0 })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Categoría</Label>
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v as ExpenseCategory })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPENSE_LABEL) as ExpenseCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {EXPENSE_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Sucursal</Label>
            <Select value={f.branch} onValueChange={(v) => setF({ ...f, branch: v as BranchId | "general" })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.short}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Método de pago</Label>
            <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v as PaymentMethod })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit}>Guardar gasto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
