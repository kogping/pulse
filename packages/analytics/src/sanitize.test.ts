import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizePayload } from "./sanitize";

describe("sanitizePayload", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalEnv ?? "test");
    vi.restoreAllMocks();
  });

  it("drops keys matching the location-PII pattern", () => {
    const result = sanitizePayload({
      venueId: "v1",
      lat: -33.8688,
      lng: 151.2093,
      latitude: -33.8688,
      longitude: 151.2093,
      coords: [1, 2],
    });

    expect(result).toEqual({ venueId: "v1" });
  });

  it("keeps keys that do not match the pattern", () => {
    const result = sanitizePayload({ venueId: "v1", position: 3, source: "feed" });

    expect(result).toEqual({ venueId: "v1", position: 3, source: "feed" });
  });

  it("logs a violation in dev when a forbidden key is dropped", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    sanitizePayload({ lat: -33.8688 });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"lat"'));
  });

  it("does not log in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    sanitizePayload({ lat: -33.8688 });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
