import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/edge-config", () => ({ get }));

const { __resetFlagCacheForTests, getFlag, precinctFlag } = await import("./flags");

beforeEach(() => {
  get.mockReset();
  __resetFlagCacheForTests();
});

describe("getFlag", () => {
  it("returns the Edge Config value when it's a boolean", async () => {
    get.mockResolvedValue(true);
    expect(await getFlag("transport_live_enabled")).toBe(true);
  });

  it("defaults transport_live_enabled and accessibility_filter_enabled to OFF", async () => {
    get.mockResolvedValue(undefined);
    expect(await getFlag("transport_live_enabled")).toBe(false);
    expect(await getFlag("accessibility_filter_enabled")).toBe(false);
  });

  it("defaults map_enabled to ON", async () => {
    get.mockResolvedValue(undefined);
    expect(await getFlag("map_enabled")).toBe(true);
  });

  it("defaults dynamic precinct flags to OFF", async () => {
    get.mockResolvedValue(undefined);
    expect(await getFlag(precinctFlag("newtown"))).toBe(false);
  });

  it("falls back to the default without throwing when Edge Config read fails", async () => {
    get.mockRejectedValue(new Error("EDGE_CONFIG is not defined"));
    await expect(getFlag("map_enabled")).resolves.toBe(true);
  });

  it("falls back to the default when Edge Config returns a non-boolean value", async () => {
    get.mockResolvedValue("yes");
    expect(await getFlag("transport_live_enabled")).toBe(false);
  });

  it("caches a value for 30s and doesn't re-read Edge Config", async () => {
    get.mockResolvedValue(true);
    await getFlag("map_enabled");
    await getFlag("map_enabled");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("re-reads Edge Config once the 30s cache expires", async () => {
    vi.useFakeTimers();
    try {
      get.mockResolvedValue(true);
      await getFlag("map_enabled");
      vi.advanceTimersByTime(30_001);
      await getFlag("map_enabled");
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches each flag key independently", async () => {
    get.mockResolvedValue(true);
    await getFlag("map_enabled");
    await getFlag("transport_live_enabled");
    expect(get).toHaveBeenCalledTimes(2);
  });
});
