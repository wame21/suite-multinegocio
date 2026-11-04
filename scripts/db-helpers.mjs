// Piezas comunes de db-test.mjs y db-flows.mjs: conexión al Supabase LOCAL, registro de resultados, alta de usuarios/negocios y limpieza.
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const raw = execSync("pnpm exec supabase status -o json", { encoding: "utf8" });
const status = JSON.parse(raw.slice(raw.indexOf("{")));
export const URL = status.API_URL;
export const KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
export const SERVICE_KEY = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
// `URL` aquí es la cadena exportada; el constructor es el global.
if (!["127.0.0.1", "localhost"].includes(new globalThis.URL(URL).hostname)) throw new Error("Solo se ejecuta contra Supabase local");

const PASSWORD = "Prueba123!";
// Las llaves de prueba de Turnstile del config local aceptan cualquier token.
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";
export const results = [];
export const check = (name, ok, detail = "") => results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
export const expectError = async (name, promise, match) => {
  const { error } = await promise;
  check(name, !!error && (!match || match.test(error.message)), error ? error.message : "no hubo error");
};
// Escrituras que RLS rechaza con error o que simplemente no tocan ninguna fila.
export const expectDenied = async (name, promise) => {
  const { data, error } = await promise;
  check(name, !!error || !data || (Array.isArray(data) && data.length === 0), error?.message ?? `${data?.length ?? 0} filas`);
};

// Cliente con la llave de servicio: se salta RLS para mover fechas de membresía, aprobar negocios y limpiar.
export const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

// Lo creado en esta corrida; cleanup() borra solo esto.
const created = { users: [], businesses: [], ips: [] };

// ip: fija cf-connecting-ip, la llave con que la función invite-lookup limita los intentos (en local no hay Cloudflare que la ponga).
// Tiene que ser una IPv4 válida: cualquier otro texto cae en la llave común "sin-ip".
export const fakeIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
export const newClient = (ip) => {
  if (ip) created.ips.push(ip);
  return createClient(URL, KEY, { auth: { persistSession: false }, global: { headers: ip ? { "cf-connecting-ip": ip } : {} } });
};

// Consulta de códigos por la Edge Function invite-lookup; el error trae el mensaje y el status que manda la función.
export async function inviteLookup(client, code, headers) {
  const { data, error } = await client.functions.invoke("invite-lookup", { body: { code }, headers });
  if (!error) return { data: data.name, error: null };
  const body = error.context instanceof Response ? await error.context.json().catch(() => ({})) : {};
  return { data: null, error: { message: body.error ?? error.message, status: error.context?.status } };
}

// Alta por el flujo público (pasa por el captcha y el límite de auth): solo para las pruebas que tratan del alta.
export async function signUp(email, data) {
  const c = newClient();
  const { data: res, error } = await c.auth.signUp({ email, password: PASSWORD, options: { data, captchaToken: CAPTCHA } });
  if (res?.user?.id) created.users.push(res.user.id);
  return { client: c, id: res?.user?.id, error };
}

export async function signIn(client, email) {
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD, options: { captchaToken: CAPTCHA } });
  if (error) throw error;
  return (await client.auth.getUser()).data.user.id;
}

// Cambia el negocio activo de la sesión (set_active_business) y devuelve su id.
export async function setActive(db, businessId) {
  const { error } = await db.rpc("set_active_business", { p_id: businessId });
  if (error) throw error;
  return businessId;
}

// Los negocios nacen en revisión: las pruebas los aceptan como lo haría el administrador de la plataforma.
export const approve = async (businessId) => {
  const { error } = await service.from("businesses").update({ approved_at: new Date().toISOString() }).eq("id", businessId);
  if (error) throw error;
};

// create_business + set_active_business (+ aprobar). El negocio queda registrado para la limpieza.
export async function createBusiness(db, name, kind = "boutique", { approved = true } = {}) {
  const { data: id, error } = await db.rpc("create_business", { p_name: name, p_kind: kind });
  if (error) throw error;
  created.businesses.push(id);
  await setActive(db, id);
  if (approved) await approve(id);
  return id;
}

// Alta con la llave de servicio (mismo trigger handle_new_user, sin pasar por el límite de auth).
// business_name / kind crean y activan un negocio aprobado; el resto va a user_metadata (name, invite_code).
export async function user(email, { business_name, kind, ...meta }) {
  const { data: res, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: meta });
  if (error) throw error;
  created.users.push(res.user.id);
  const client = newClient();
  await signIn(client, email);
  const u = { db: client, id: res.user.id, email, businessId: null };
  if (business_name) u.businessId = await createBusiness(client, business_name, kind);
  return u;
}

// Administrador de la plataforma: usuario normal dado de alta en platform_admins.
export async function platformAdmin(email) {
  const admin = await user(email, { name: "Admin" });
  const { error } = await service.from("platform_admins").insert({ user_id: admin.id });
  if (error) throw error;
  return admin;
}

const stamp = Date.now();
export const mail = (who) => `${who}${stamp}@example.test`;

// Borra solo lo registrado arriba: archivos de logotipo, intentos de invite-lookup, negocios (las FK en cascada se llevan sus
// tablas y membresías) y al final los usuarios (perfil y platform_admins caen en cascada). Cada paso corre aunque falle otro.
export async function cleanup() {
  const log = (what, error) => error && console.error(`limpieza: ${what}: ${error.message}`);
  if (created.users.length) {
    // Negocios de esos usuarios que no se registraron al crearlos (p. ej. alta que falló a medias).
    const { data } = await service.from("business_members").select("business_id").eq("role", "dueno").in("user_id", created.users);
    created.businesses.push(...(data ?? []).map((m) => m.business_id));
  }
  const businesses = [...new Set(created.businesses)];
  for (const id of businesses) {
    const { data: files } = await service.storage.from("logos").list(id);
    if (files?.length) log("logos", (await service.storage.from("logos").remove(files.map((f) => `${id}/${f.name}`))).error);
  }
  if (created.ips.length) log("invite_attempts", (await service.from("invite_attempts").delete().in("key", created.ips)).error);
  if (businesses.length) log("businesses", (await service.from("businesses").delete().in("id", businesses)).error);
  for (const id of created.users) log(`usuario ${id}`, (await service.auth.admin.deleteUser(id)).error);
  created.users = [];
  created.businesses = [];
  created.ips = [];
}

// También si el script truena: la limpieza corre y luego se sale con error.
const crash = async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
process.on("SIGINT", () => crash(new Error("Interrumpido")));

export async function report() {
  await cleanup();
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("✗")).length;
  console.log(`\n${results.length - failed}/${results.length} pruebas correctas`);
  process.exit(failed ? 1 : 0);
}
