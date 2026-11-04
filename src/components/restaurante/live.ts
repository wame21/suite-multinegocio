"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listTables, listTableOrders, setTableOrderStatus, subscribeTableOrders, type DiningTable, type TableOrder, type TableOrderStatus } from "@/lib/restaurant";
import { errorMessage } from "@/lib/store";
import { mergeOrders, upsertOrder } from "./orders";

/** Medianoche de hoy (ISO) para cargar "hoy"; sin argumento, la lectura trae las últimas 24 horas. */
export const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

/** Reloj para tiempos transcurridos; se actualiza cada `ms`. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Pedidos y mesas del negocio, con cambios en vivo; `move` pide el cambio de estado a la base (que valida puesto y transición). */
export function useRestaurantLive(since?: string) {
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    // Se suscribe antes de leer: lo que llegue mientras carga se mezcla sin perderse.
    const unsubscribe = subscribeTableOrders((o) => setOrders((list) => upsertOrder(list, o)));
    Promise.all([listTableOrders(since), listTables()])
      .then(([fetched, t]) => {
        if (off) return;
        setOrders((live) => mergeOrders(fetched, live));
        setTables(t);
        setLoaded(true);
      })
      .catch((e) => !off && setError(errorMessage(e)));
    return () => {
      off = true;
      unsubscribe();
    };
  }, [since]);

  const move = useCallback(async (id: string, status: TableOrderStatus, done?: string) => {
    setBusy(id);
    try {
      const o = await setTableOrderStatus(id, status);
      setOrders((list) => upsertOrder(list, o));
      if (done) toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  return { orders, tables, loaded, error, busy, move };
}
