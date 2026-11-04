"use client";

import { useEffect, useRef } from "react";

/** Sin esta variable no hay captcha y el login funciona igual que antes. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let script: Promise<void> | undefined;
const loadScript = () =>
  (script ??= new Promise<void>((resolve, reject) => {
    if (window.turnstile) return resolve();
    const el = document.createElement("script");
    el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      script = undefined;
      reject(new Error("turnstile"));
    };
    document.head.append(el);
  }));

/**
 * Widget de Cloudflare Turnstile. El token es de un solo uso: el padre cambia `run` después de cada intento
 * (con o sin éxito) y el widget se vuelve a dibujar. `onToken(null)` indica que no hay token válido (expiró o falló).
 */
export function Turnstile({ run, onToken }: { run: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let id: string | undefined;
    let gone = false;
    loadScript()
      .then(() => {
        if (gone || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          size: "flexible",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [run, onToken]);

  return TURNSTILE_SITE_KEY ? <div ref={box} className="min-h-[65px]" /> : null;
}
