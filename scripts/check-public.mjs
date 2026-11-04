// Verifica lo que ve internet: node scripts/check-public.mjs <url>   (ej. http://localhost:8000 o https://tu-dominio.com)
// No crea cuentas ni datos: usa un correo inexistente y un correo mal formado. Sale con código 1 si algo falla.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Uso: node scripts/check-public.mjs <url>");
  process.exit(2);
}

// La publishable key es pública (viaja en el navegador); se lee del entorno o de .env.production.local.
let pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
try {
  pub ??= readFileSync(new URL("../.env.production.local", import.meta.url), "utf8").match(/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1];
} catch {}
if (!pub) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (entorno o .env.production.local)");
  process.exit(2);
}

// Valores de fábrica del CLI de Supabase: públicos para cualquiera.
const DEFAULT_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const DEFAULT_PUBLISHABLE = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
// La secret key de fábrica no va en el repo (la protección de secretos de GitHub la bloquea aunque sea pública):
// pásala en SUPABASE_FACTORY_SECRET_KEY (es la que `supabase status` muestra en un proyecto sin llaves propias); sin ella se omite esa prueba.
const DEFAULT_SECRET = process.env.SUPABASE_FACTORY_SECRET_KEY;
if (!DEFAULT_SECRET) console.log("omitida  rechaza secret key de fábrica (falta SUPABASE_FACTORY_SECRET_KEY)");
const forge = (role) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ iss: "supabase-demo", role, exp: 2000000000 })}`;
  return `${body}.${createHmac("sha256", DEFAULT_JWT_SECRET).update(body).digest("base64url")}`;
};

const req = (path, { headers, ...init } = {}) => fetch(base + path, { redirect: "manual", ...init, headers }).then(async (r) => ({ r, text: await r.text() }));
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json", apikey: pub }, body: JSON.stringify(body) });
const authError = (t) => { try { return JSON.parse(t).error_code; } catch { return undefined; } };

let failed = 0;
const check = async (name, fn) => {
  try {
    const bad = await fn();
    console.log(`${bad ? "FALLA" : "ok   "}  ${name}${bad ? ` -> ${bad}` : ""}`);
    if (bad) failed++;
  } catch (e) {
    console.log(`FALLA  ${name} -> ${e.message}`);
    failed++;
  }
};
const kongHeader = (r) => [...r.headers.keys()].some((k) => k.startsWith("x-kong"));

// 1. Nada interno se alcanza por esta URL.
for (const path of ["/pg/tables", "/pg/", "/studio", "/api/platform/projects", "/analytics/v1/", "/graphql/v1", "/mcp", "/rest/v1/", "/inbucket", "/api/mail"]) {
  await check(`no expone ${path}`, async () => {
    const { r } = await req(path, { headers: { apikey: pub } });
    return r.status === 200 ? "responde 200" : kongHeader(r) ? "pasó por Kong" : undefined;
  });
}

// Rutas que sí cruzan a Supabase pero deben negarse sin credenciales de servicio.
for (const path of ["/storage/v1/s3", "/auth/v1/admin/users"]) {
  await check(`niega ${path} con la llave pública`, async () => {
    const { r } = await req(path, { headers: { apikey: pub } });
    return r.status >= 400 ? undefined : `status ${r.status}`;
  });
}

// 2. Llaves y tokens de fábrica rechazados (y la propia sí funciona: control).
await check("control: la publishable propia entra", async () => {
  const { r } = await req("/storage/v1/bucket", { headers: { apikey: pub } });
  return r.status === 200 ? undefined : `esperaba 200, dio ${r.status}`;
});
for (const [label, headers] of [
  ["publishable de fábrica", { apikey: DEFAULT_PUBLISHABLE }],
  ...(DEFAULT_SECRET ? [["secret key de fábrica", { apikey: DEFAULT_SECRET }]] : []),
  ["JWT service_role firmado con el secreto de fábrica", { apikey: forge("service_role"), authorization: `Bearer ${forge("service_role")}` }],
  ["JWT anon firmado con el secreto de fábrica", { apikey: forge("anon"), authorization: `Bearer ${forge("anon")}` }],
]) {
  await check(`rechaza ${label}`, async () => {
    const { r, text } = await req("/storage/v1/bucket", { headers });
    const rest = await req("/rest/v1/businesses?select=id&limit=1", { headers });
    if (r.status === 200) return `/storage respondió 200: ${text.slice(0, 60)}`;
    return rest.r.status === 200 ? "/rest respondió 200" : undefined;
  });
}

// 3. Sin captcha no hay inicio de sesión ni registro (el correo mal formado evita crear cuenta aunque el captcha faltara).
await check("inicio de sesión sin captcha rechazado", async () => {
  const { text } = await req("/auth/v1/token?grant_type=password", json({ email: "no-existe@example.invalid", password: "Clave-falsa-123" }));
  return authError(text) === "captcha_failed" ? undefined : `error_code=${authError(text)}`;
});
await check("registro sin captcha rechazado", async () => {
  const { text } = await req("/auth/v1/signup", json({ email: "no-es-un-correo", password: "Clave-falsa-123" }));
  return authError(text) === "captcha_failed" ? undefined : `error_code=${authError(text)}`;
});

// 4. Cabeceras de seguridad y de información.
await check("cabeceras de seguridad en /login", async () => {
  const { r } = await req("/login");
  const miss = ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"].filter((h) => !r.headers.has(h));
  if (r.headers.has("server")) miss.push(`no debe haber Server (${r.headers.get("server")})`);
  if (r.headers.has("x-powered-by")) miss.push("no debe haber X-Powered-By");
  return miss.length ? miss.join(", ") : undefined;
});
if (base.startsWith("https://")) {
  await check("HSTS presente (https)", async () => ((await req("/login")).r.headers.has("strict-transport-security") ? undefined : "falta Strict-Transport-Security (actívalo en Cloudflare)"));
}

// 5. Rutas públicas y privadas de la app.
await check("/m/x es pública (no manda a /login)", async () => {
  const { r } = await req("/m/x");
  return (r.headers.get("location") ?? "").includes("/login") ? `redirige a ${r.headers.get("location")}` : undefined;
});
await check("/ sin sesión manda a /login", async () => {
  const { r } = await req("/");
  return r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").endsWith("/login") ? undefined : `status ${r.status}, location ${r.headers.get("location")}`;
});

// 6. Límite de tamaño de petición (los logos pesan hasta 2 MB).
await check("petición de 4 MB rechazada (413)", async () => {
  const { r } = await req("/storage/v1/object/x/y", { method: "POST", headers: { apikey: pub, "content-type": "application/octet-stream" }, body: Buffer.alloc(4 * 1024 * 1024) });
  return r.status === 413 ? undefined : `status ${r.status}`;
});

console.log(failed ? `\n${failed} comprobación(es) fallaron` : "\nTodo en orden");
process.exit(failed ? 1 : 0);
