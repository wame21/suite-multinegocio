// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_CATALOG } from "@/lib/settings";
import {
  useActiveBranches,
  useBranches,
  useBranchName,
  useBusinessName,
  useCanCancelOrders,
  useCanMoveStock,
  useCategories,
  useChannels,
  useErp,
  useIsOwner,
  usePosBranches,
  useWarehouse,
  useWholesaleEnabled,
} from "@/lib/store";
import type { Branch } from "@/lib/types";
import { applyWholesaleSettings, DEFAULT_WHOLESALE } from "@/lib/wholesale";

const upsert = vi.hoisted(() => vi.fn(() => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) })));
vi.mock("@/lib/supabase/client", () => ({ supabase: () => ({ from: () => ({ upsert }) }) }));

const branch = (patch: Partial<Branch> = {}): Branch => ({
  id: "br-1",
  name: "Sucursal Centro",
  short: "Centro",
  address: "",
  pos: true,
  isWarehouse: false,
  active: true,
  sort: 0,
  ...patch,
});

const BRANCHES: Branch[] = [
  branch({ id: "br-1", short: "Centro", isWarehouse: true }),
  branch({ id: "br-2", short: "Norte", pos: false }),
  branch({ id: "br-3", short: "Vieja", active: false }),
];

const INITIAL = useErp.getState();

beforeEach(() => {
  useErp.setState(INITIAL, true);
  applyWholesaleSettings(DEFAULT_WHOLESALE);
  upsert.mockClear();
});

afterEach(() => {
  cleanup();
});

/** Cuenta los renders para detectar ciclos infinitos. */
function hook<T>(use: () => T) {
  let renders = 0;
  const view = renderHook(() => {
    renders++;
    return use();
  });
  return { view, renders: () => renders };
}

describe("useIsOwner y useBusinessName", () => {
  it("useIsOwner es falso por defecto y verdadero para el dueño", () => {
    const { view } = hook(useIsOwner);
    expect(view.result.current).toBe(false);
    act(() => useErp.setState({ role: "dueno" }));
    expect(view.result.current).toBe(true);
  });

  it.each([
    ["dueno", true],
    ["encargado", true],
    ["vendedor", false],
    ["cajero", false],
  ] as const)("useCanMoveStock y useCanCancelOrders con rol %s → %s", (role, allowed) => {
    act(() => useErp.setState({ role }));
    expect(hook(useCanMoveStock).view.result.current).toBe(allowed);
    expect(hook(useCanCancelOrders).view.result.current).toBe(allowed);
  });

  it("useBusinessName usa APP_NAME sin negocio y el nombre cuando carga", () => {
    const { view } = hook(useBusinessName);
    expect(view.result.current).toBe(APP_NAME);
    act(() => useErp.setState({ business: { id: "b-1", name: "Boutique Aurora", kind: "boutique", inviteCode: "ABCD2345", orderPrefix: "V-", quotePrefix: "COT-" } }));
    expect(view.result.current).toBe("Boutique Aurora");
  });
});

describe("hooks de sucursales", () => {
  beforeEach(() => {
    useErp.setState({ branches: BRANCHES });
  });

  it("useBranches devuelve todas, también las archivadas, con la misma referencia", () => {
    const { view, renders } = hook(useBranches);
    expect(view.result.current).toBe(BRANCHES);
    view.rerender();
    expect(view.result.current).toBe(BRANCHES);
    expect(renders()).toBeLessThanOrEqual(2);
  });

  it("useActiveBranches excluye archivadas y mantiene la referencia entre renders", () => {
    const { view, renders } = hook(useActiveBranches);
    const first = view.result.current;
    expect(first.map((b) => b.id)).toEqual(["br-1", "br-2"]);
    view.rerender();
    expect(view.result.current).toBe(first);
    act(() => useErp.setState({ team: [] }));
    expect(view.result.current).toBe(first);
    expect(renders()).toBeLessThanOrEqual(3);
    act(() => useErp.setState({ branches: [...BRANCHES, branch({ id: "br-4", short: "Sur" })] }));
    expect(view.result.current).not.toBe(first);
    expect(view.result.current.map((b) => b.id)).toEqual(["br-1", "br-2", "br-4"]);
  });

  it("usePosBranches solo trae activas con mostrador y mantiene la referencia", () => {
    const { view } = hook(usePosBranches);
    const first = view.result.current;
    expect(first.map((b) => b.id)).toEqual(["br-1"]);
    view.rerender();
    expect(view.result.current).toBe(first);
  });

  it("useWarehouse devuelve la sucursal que surte, o undefined si no hay", () => {
    const { view } = hook(useWarehouse);
    expect(view.result.current?.id).toBe("br-1");
    act(() => useErp.setState({ branches: [branch({ id: "br-2" })] }));
    expect(view.result.current).toBeUndefined();
  });

  it("useBranchName devuelve el nombre corto, resuelve archivadas y cae al id", () => {
    const { view } = hook(useBranchName);
    const fn = view.result.current;
    expect(fn("br-1")).toBe("Centro");
    expect(fn("br-3")).toBe("Vieja");
    expect(fn("desconocida")).toBe("desconocida");
    view.rerender();
    expect(view.result.current).toBe(fn);
    act(() => useErp.setState({ branches: [branch({ id: "br-1", short: "Matriz" })] }));
    expect(view.result.current).not.toBe(fn);
    expect(view.result.current("br-1")).toBe("Matriz");
  });
});

describe("mayoreo, canales y categorías", () => {
  it("useWholesaleEnabled sigue wholesale.enabled", () => {
    const { view } = hook(useWholesaleEnabled);
    expect(view.result.current).toBe(false);
    act(() => useErp.setState({ wholesale: { ...DEFAULT_WHOLESALE, enabled: true } }));
    expect(view.result.current).toBe(true);
  });

  it("useChannels excluye mayoreo si el módulo está apagado, aunque esté en la lista", () => {
    useErp.setState({ sales: { ...useErp.getState().sales, channels: ["tienda", "mayoreo", "web"] } });
    const { view } = hook(useChannels);
    expect(view.result.current).toEqual(["tienda", "web"]);
  });

  it("useChannels agrega mayoreo al final solo si wholesale.enabled, sin duplicarlo", () => {
    useErp.setState({ sales: { ...useErp.getState().sales, channels: ["tienda", "mayoreo", "web"] } });
    const { view } = hook(useChannels);
    act(() => useErp.setState({ wholesale: { ...DEFAULT_WHOLESALE, enabled: true } }));
    expect(view.result.current).toEqual(["tienda", "web", "mayoreo"]);
  });

  it("useChannels mantiene la referencia con el mismo estado y no entra en ciclos", () => {
    const { view, renders } = hook(useChannels);
    const first = view.result.current;
    view.rerender();
    expect(view.result.current).toBe(first);
    act(() => useErp.setState({ team: [] }));
    expect(view.result.current).toBe(first);
    expect(renders()).toBeLessThanOrEqual(3);
  });

  it("useCategories devuelve las del catálogo con la misma referencia", () => {
    const { view } = hook(useCategories);
    expect(view.result.current).toBe(useErp.getState().catalog.categories);
    expect(view.result.current).toEqual(DEFAULT_CATALOG.categories);
    act(() => useErp.setState({ catalog: { ...DEFAULT_CATALOG, categories: ["Vestidos"] } }));
    expect(view.result.current).toEqual(["Vestidos"]);
  });

  it("saveWholesale actualiza useWholesaleEnabled y useChannels al guardar", async () => {
    useErp.setState({ profile: { id: "u-1", businessId: "b-1", name: "Ana", role: "dueno", branch: null, createdAt: "2026-01-01T00:00:00Z" } });
    const enabled = hook(useWholesaleEnabled);
    const channels = hook(useChannels);
    expect(channels.view.result.current).not.toContain("mayoreo");

    await act(async () => {
      await useErp.getState().saveWholesale({ ...DEFAULT_WHOLESALE, enabled: true });
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(enabled.view.result.current).toBe(true);
    expect(channels.view.result.current).toContain("mayoreo");
  });
});
