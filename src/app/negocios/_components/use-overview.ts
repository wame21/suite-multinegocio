"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Overview } from "@/lib/owner";
import { supabase } from "@/lib/supabase/client";

/** `owner_overview()` del rango [from, to); `null` mientras carga (o al cambiar de rango). */
export function useOverview(from: Date, to: Date) {
  const key = `${from.getTime()}|${to.getTime()}`;
  const [loaded, setLoaded] = useState<{ key: string; data: Overview } | null>(null);
  useEffect(() => {
    let live = true;
    const [p_from, p_to] = key.split("|").map((ms) => new Date(Number(ms)).toISOString());
    void supabase()
      .rpc("owner_overview", { p_from, p_to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) toast.error(error.message);
        else setLoaded({ key, data: data as Overview });
      });
    return () => {
      live = false;
    };
  }, [key]);
  return loaded?.key === key ? loaded.data : null;
}
