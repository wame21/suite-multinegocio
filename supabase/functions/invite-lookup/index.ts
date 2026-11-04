// Nombre y giro del negocio de un código de invitación, con límite de intentos por IP.
// La llave de la IP sale de cf-connecting-ip (Cloudflare lo pone y el cliente no lo altera) o, sin Cloudflare
// (Supabase local), de x-forwarded-for; en IPv6 es el prefijo /64 (ver ../table-order/request.ts).
// Se despliega con verify_jwt = false: la llave publicable no es un JWT y el login no tiene sesión.
import { withSupabase } from "npm:@supabase/server@1.9.1";
import { clientKey, readJson } from "../table-order/request.ts";

Deno.serve(
  withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405, headers: { allow: "POST" } });
    const b = await readJson(req, 1024);
    if (!b) return Response.json({ error: "Solicitud demasiado grande" }, { status: 413 });
    const code = typeof b.code === "string" ? b.code.slice(0, 64) : "";
    const { data, error } = await ctx.supabaseAdmin.rpc("invite_lookup", { p_code: code, p_key: clientKey(req) });
    if (error?.code === "PT429") return Response.json({ error: error.message }, { status: 429 });
    if (error) {
      console.error(error);
      return Response.json({ error: "No se pudo consultar el código, intenta de nuevo" }, { status: 500 });
    }
    return Response.json({ name: data?.name ?? null, kind: data?.kind ?? null });
  }),
);
