import { describe, expect, it } from "vitest";
import { canOpen, homeFor, navFor, pathMatches, routeAfterLogin } from "@/lib/access";
import type { OwnerBusiness } from "@/lib/types";

const hrefs = (kind: Parameters<typeof navFor>[0], role: Parameters<typeof navFor>[1]) =>
  navFor(kind, role).flatMap((g) => g.items.map((i) => i.href));

const biz = (patch: Partial<OwnerBusiness>): OwnerBusiness => ({
  id: "b1",
  name: "Negocio",
  kind: "boutique",
  role: "dueno",
  state: "activa",
  endsAt: null,
  rejectionReason: null,
  monthSales: 0,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("navFor", () => {
  it("boutique conserva el menú de siempre para dueño y vendedor", () => {
    const all = ["/", "/pedidos", "/pos", "/inventario", "/mayoreo", "/clientes", "/finanzas", "/reportes", "/equipo", "/configuracion"];
    expect(hrefs("boutique", "dueno")).toEqual(all);
    expect(hrefs("boutique", "vendedor")).toEqual(all);
  });

  it("restaurante: el dueño ve todo en el orden del diseño", () => {
    expect(hrefs("restaurante", "dueno")).toEqual([
      "/", "/caja", "/mesas-en-vivo", "/cocina", "/menu", "/mesas", "/finanzas", "/reportes", "/equipo", "/configuracion",
    ]);
  });

  it.each([
    ["cajero", "/caja"],
    ["mesero", "/mesas-en-vivo"],
    ["cocina", "/cocina"],
  ] as const)("restaurante: %s solo ve %s", (role, href) => {
    expect(hrefs("restaurante", role)).toEqual([href]);
  });
});

describe("canOpen / homeFor", () => {
  it("cada rol de restaurante abre solo lo suyo y su inicio es su pantalla", () => {
    expect(canOpen("restaurante", "cajero", "/caja")).toBe(true);
    expect(canOpen("restaurante", "cajero", "/cocina")).toBe(false);
    expect(canOpen("restaurante", "cajero", "/")).toBe(false);
    expect(canOpen("restaurante", "mesero", "/mesas")).toBe(false);
    expect(canOpen("restaurante", "mesero", "/mesas-en-vivo")).toBe(true);
    expect(canOpen("restaurante", "cocina", "/finanzas")).toBe(false);
    expect(homeFor("restaurante", "cajero")).toBe("/caja");
    expect(homeFor("restaurante", "mesero")).toBe("/mesas-en-vivo");
    expect(homeFor("restaurante", "cocina")).toBe("/cocina");
    expect(homeFor("restaurante", "dueno")).toBe("/");
  });

  it("el dueño de restaurante no abre rutas de boutique y viceversa", () => {
    expect(canOpen("restaurante", "dueno", "/menu")).toBe(true);
    expect(canOpen("restaurante", "dueno", "/pos")).toBe(false);
    expect(canOpen("boutique", "dueno", "/pos")).toBe(true);
    expect(canOpen("boutique", "dueno", "/caja")).toBe(false);
    expect(canOpen("boutique", "vendedor", "/pedidos/nuevo")).toBe(true);
    expect(homeFor("boutique", "vendedor")).toBe("/");
  });

  it("/mesas no enciende /mesas-en-vivo", () => {
    expect(pathMatches("/mesas", "/mesas-en-vivo")).toBe(false);
    expect(pathMatches("/mesas", "/mesas/qr")).toBe(true);
    expect(pathMatches("/", "/pos")).toBe(false);
  });
});

describe("routeAfterLogin", () => {
  it("administrador va a /admin aunque tenga negocios", () => {
    expect(routeAfterLogin(true, [biz({})])).toBe("/admin");
  });

  it("dueño, o cuenta sin negocios, va a /negocios", () => {
    expect(routeAfterLogin(false, [])).toBe("/negocios");
    expect(routeAfterLogin(false, [biz({ role: "dueno", kind: "restaurante" })])).toBe("/negocios");
  });

  it("personal aprobado entra al panel de su negocio", () => {
    expect(routeAfterLogin(false, [biz({ role: "vendedor" })])).toBe("/");
    expect(routeAfterLogin(false, [biz({ role: "cajero", kind: "restaurante" })])).toBe("/caja");
    expect(routeAfterLogin(false, [biz({ role: "cocina", kind: "restaurante" })])).toBe("/cocina");
  });

  it("personal pendiente va a / (pantalla de pendiente)", () => {
    expect(routeAfterLogin(false, [biz({ role: "pendiente", kind: "restaurante" })])).toBe("/");
  });
});
