// Crea el pedido de mesa de un comensal anónimo, con límite de intentos por IP (igual que invite-lookup).
// place_table_order solo la puede ejecutar service_role: aquí se manda la llave de la IP (cf-connecting-ip de Cloudflare,
// o x-forwarded-for sin Cloudflare; en IPv6 el prefijo /64, ver request.ts). Los precios los recalcula la RPC; aquí solo se reenvía.
// No se aceptan archivos: el comprobante de una transferencia lo revisa caja en el banco.
// Se despliega con verify_jwt = false: el comensal no tiene sesión y la llave publicable no es un JWT.
import { withSupabase } from "npm:@supabase/server@1.9.1";
import { clientKey, readJson } from "./request.ts";

const MAX_BODY = 128 * 1024; // 30 renglones con 30 opciones y notas caben de sobra
const text = (v: unknown) => (typeof v === "string" ? v : "");

Deno.serve(
  withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405, headers: { allow: "POST" } });
    const b = await readJson(req, MAX_BODY);
    if (!b) return Response.json({ error: "El pedido es demasiado grande" }, { status: 413 });
    const { data, error } = await ctx.supabaseAdmin.rpc("place_table_order", {
      p_token: text(b.token),
      p_name: text(b.name),
      p_items: b.items ?? null,
      p_note: text(b.note) || null,
      p_method: text(b.method),
      p_key: `pedido:${clientKey(req)}`,
    });
    // La RPC marca con PT4xx los errores que el comensal puede corregir (PostgREST responde ese código HTTP).
    if (error?.code?.startsWith("PT4")) return Response.json({ error: error.message }, { status: Number(error.code.slice(2)) });
    if (error) {
      console.error(error);
      return Response.json({ error: "No se pudo crear el pedido, intenta de nuevo" }, { status: 500 });
    }
    return Response.json(data);
  }),
);
