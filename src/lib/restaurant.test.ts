import { describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];
const row = { id: "t1", name: "Mesa 1", area: "Terraza", qr_token: "tok", active: false, sort: 0 };
let fail: { code: string; message: string } | null = null; // error que devuelve la base en la siguiente llamada
const builder = {
  update: (fields: unknown) => (sent.push(fields), builder),
  insert: (fields: unknown) => (sent.push(fields), builder),
  delete: () => builder,
  eq: () => builder,
  then: (done: (r: { error: typeof fail }) => unknown) => done({ error: fail }), // `await delete().eq()`
  select: () => builder,
  single: async () => (fail ? { data: null, error: fail } : { data: row, error: null }),
};
vi.mock("@/lib/supabase/client", () => ({ supabase: () => ({ from: () => builder }) }));

const { deleteTable, saveTable } = await import("./restaurant");

describe("saveTable", () => {
  it("al desactivar con la mesa completa solo manda columnas editables (sin qrToken)", async () => {
    const table = { id: "t1", name: "Mesa 1", area: "Terraza", qrToken: "tok", active: true, sort: 0 };
    const saved = await saveTable({ ...table, active: false });
    expect(sent).toEqual([{ name: "Mesa 1", area: "Terraza", active: false, sort: 0 }]);
    expect(saved.active).toBe(false);
  });

  it("un nombre repetido (23505) da un mensaje claro", async () => {
    fail = { code: "23505", message: 'duplicate key value violates unique constraint "dining_tables_business_id_name_key"' };
    await expect(saveTable({ name: "Mesa 1", area: "", active: true, sort: 0 })).rejects.toThrow("Ya existe una mesa con ese nombre");
    fail = null;
  });
});

describe("deleteTable", () => {
  it("borra sin error", async () => {
    await expect(deleteTable("t1")).resolves.toBeUndefined();
  });

  it("con pedidos (23503) manda desactivarla en vez del error de Postgres", async () => {
    fail = { code: "23503", message: "violates foreign key constraint" };
    await expect(deleteTable("t1")).rejects.toThrow("Esta mesa ya tiene pedidos: desactívala en lugar de borrarla");
    fail = null;
  });

  it("otro error pasa tal cual", async () => {
    fail = { code: "42501", message: "permission denied" };
    await expect(deleteTable("t1")).rejects.toThrow("permission denied");
    fail = null;
  });
});
