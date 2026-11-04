// Helpers de las Edge Functions públicas (table-order e invite-lookup, que lo importa desde aquí).

// Llave del límite por IP. Cloudflare pone cf-connecting-ip y el cliente no puede alterarlo; sin Cloudflare (Supabase
// local) se usa el primer x-forwarded-for. En IPv6 la llave es el prefijo /64: quien tiene una red IPv6 rota de dirección
// dentro de su /64 sin costo, así que contar por dirección completa no limitaría nada. Lo que no es una IP válida comparte
// la llave "sin-ip" (el límite se vuelve común en vez de saltarse).
export function clientKey(req: Request): string {
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  if (!ip.includes(":")) return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : "sin-ip";
  let host: string;
  try {
    host = new URL(`http://[${ip}]/`).hostname.slice(1, -1); // forma canónica, con ::
  } catch {
    return "sin-ip";
  }
  const [a, b = ""] = host.split("::");
  const head = a ? a.split(":") : [];
  const tail = b ? b.split(":") : [];
  const g = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  if (g.slice(0, 5).every((x) => x === "0") && g[5] === "ffff") { // IPv4 escrita como ::ffff:a.b.c.d
    const n = (parseInt(g[6], 16) << 16) | parseInt(g[7], 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return `${g.slice(0, 4).map((x) => x.padStart(4, "0")).join(":")}::/64`;
}

// Cuerpo JSON de a lo más `max` bytes. undefined = demasiado grande; {} = vacío, mal formado o que no es un objeto.
export async function readJson(req: Request, max: number): Promise<Record<string, unknown> | undefined> {
  if (Number(req.headers.get("content-length")) > max) return undefined;
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  const reader = req.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const body = JSON.parse(text + decoder.decode());
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}
