import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-path";

describe("isPublicPath", () => {
  it("deja pasar el login y todo lo que cuelga de /m", () => {
    for (const p of ["/login", "/m", "/m/abc", "/m/abc/pedido/xyz"]) expect(isPublicPath(p)).toBe(true);
  });

  it("el resto sigue protegido, incluidas rutas que solo empiezan con la letra m", () => {
    for (const p of ["/", "/pos", "/mayoreo", "/mayoreo/nueva", "/mesas", "/negocios", "/admin", "/login/x", "/x/m/abc"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
