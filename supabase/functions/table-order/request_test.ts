import { assertEquals } from "jsr:@std/assert@1";
import { clientKey, readJson } from "./request.ts";

const key = (h: Record<string, string>) => clientKey(new Request("http://x", { headers: h }));
const post = (body: string, h: Record<string, string> = {}) => new Request("http://x", { method: "POST", body, headers: h });

Deno.test("IPv4: llave = la dirección; cf-connecting-ip gana a x-forwarded-for", () => {
  assertEquals(key({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }), "203.0.113.7");
  assertEquals(key({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }), "198.51.100.2");
});

Deno.test("IPv6: direcciones del mismo /64 comparten llave, otro /64 no", () => {
  const a = key({ "cf-connecting-ip": "2001:db8:abcd:12::1" });
  assertEquals(a, "2001:0db8:abcd:0012::/64");
  assertEquals(key({ "cf-connecting-ip": "2001:DB8:abcd:12:ffff:ffff:ffff:ffff" }), a);
  assertEquals(key({ "cf-connecting-ip": "2001:db8:abcd:12:1:2:3:4" }), a);
  assertEquals(key({ "cf-connecting-ip": "2001:db8:abcd:13::1" }) === a, false);
  assertEquals(key({ "cf-connecting-ip": "::1" }), "0000:0000:0000:0000::/64");
});

Deno.test("IPv4 dentro de IPv6 y basura", () => {
  assertEquals(key({ "cf-connecting-ip": "::ffff:203.0.113.7" }), "203.0.113.7");
  assertEquals(key({}), "sin-ip");
  assertEquals(key({ "cf-connecting-ip": "no-es-ip" }), "sin-ip");
  assertEquals(key({ "cf-connecting-ip": "1:2:3:4:5:6:7:8:9" }), "sin-ip");
  assertEquals(key({ "cf-connecting-ip": "fe80::1%eth0" }), "sin-ip");
});

Deno.test("readJson: tope de tamaño, JSON malo y no-objetos", async () => {
  assertEquals(await readJson(post('{"a":1}'), 100), { a: 1 });
  assertEquals(await readJson(post("x".repeat(200)), 100), undefined);
  assertEquals(await readJson(post("x".repeat(200), { "content-length": "999999" }), 100), undefined);
  assertEquals(await readJson(post("no es json"), 100), {});
  assertEquals(await readJson(post("null"), 100), {});
  assertEquals(await readJson(post("[1,2]"), 100), {});
  assertEquals(await readJson(new Request("http://x"), 100), {});
});
