import { describe, expect, it } from "vitest";
import { passwordError } from "@/lib/password";

describe("passwordError", () => {
  it.each(["corta1", "sololetrasaqui", "1234567890", "abc123"])("rechaza %s", (pw) => {
    expect(passwordError(pw)).toMatch(/10 caracteres/);
  });

  it("acepta 10 o más caracteres con letras y números", () => {
    expect(passwordError("contraseña1")).toBeNull();
    expect(passwordError("abcde12345")).toBeNull();
  });
});
