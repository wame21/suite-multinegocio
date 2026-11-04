import { getRestaurantSettings, saveRestaurantSettings, type RestaurantSettings } from "@/lib/restaurant";
import { supabase } from "@/lib/supabase/client";
import { useErp } from "@/lib/store";

/** Guarda solo los campos dados sobre la configuración vigente: cada pestaña edita lo suyo sin pisar a las demás. */
export async function patchRestaurant(patch: Partial<RestaurantSettings>) {
  await saveRestaurantSettings({ ...(await getRestaurantSettings()), ...patch });
}

/** `settings.profile` del negocio. El store no lo carga en restaurante, así que se lee y se mezcla aquí. */
export async function readProfile(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase().from("settings").select("value").eq("key", "profile").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as Record<string, unknown>) ?? {};
}

export async function patchProfile(patch: Record<string, unknown>) {
  const businessId = useErp.getState().profile?.businessId;
  if (!businessId) throw new Error("No hay una sesión activa");
  const value = { ...(await readProfile()), ...patch };
  const { error } = await supabase()
    .from("settings")
    .upsert({ business_id: businessId, key: "profile", value, updated_at: new Date().toISOString() }, { onConflict: "business_id,key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
}
