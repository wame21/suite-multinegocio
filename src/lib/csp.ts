const TURNSTILE = "https://challenges.cloudflare.com";

/**
 * Content-Security-Policy con nonce por petición (la pone src/proxy.ts).
 * `supabaseUrl` se admite tal cual para http y ws: en local la API está en otro puerto; en producción es el mismo origen.
 * style-src conserva 'unsafe-inline' porque React/Radix/gráficas usan atributos `style` (un nonce los dejaría sin efecto).
 */
export function buildCsp({ nonce, supabaseUrl, dev }: { nonce: string; supabaseUrl: string; dev: boolean }) {
  const origin = new URL(supabaseUrl).origin;
  const ws = origin.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https: ${origin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${origin} ${ws}${dev ? " ws:" : ""} ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
