import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const csp = (dev = false) => buildCsp({ nonce: "abc", supabaseUrl: "http://127.0.0.1:54321", dev });

describe("buildCsp", () => {
  it("prohíbe enmarcar la app y los plugins", () => {
    expect(csp()).toContain("frame-ancestors 'none'");
    expect(csp()).toContain("object-src 'none'");
  });

  it("scripts solo con nonce; unsafe-eval únicamente en desarrollo", () => {
    expect(csp()).toContain("'nonce-abc'");
    expect(csp()).not.toContain("unsafe-eval");
    expect(csp(true)).toContain("'unsafe-eval'");
  });

  it("permite Supabase (http y ws) y Turnstile", () => {
    const c = csp();
    expect(c).toContain("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(c).toContain("frame-src https://challenges.cloudflare.com");
  });

  it("usa wss con una API https", () => {
    expect(buildCsp({ nonce: "n", supabaseUrl: "https://x.example.com/", dev: false })).toContain("wss://x.example.com");
  });
});
