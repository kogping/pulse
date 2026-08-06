import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetEnvCacheForTests, getDatabaseEnv, getEnv, getGooglePlacesEnv, getMapboxEnv, getUpstashEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgresql://user:pass@host.ap-southeast-2.aws.neon.tech/neondb?sslmode=require",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
  MAPBOX_TOKEN: "token",
  GOOGLE_PLACES_API_KEY: "token",
};

function stubEnv(overrides: Partial<typeof VALID> = {}) {
  const merged = { ...VALID, ...overrides };
  for (const [key, value] of Object.entries(merged)) vi.stubEnv(key, value);
}

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetEnvCacheForTests();
  });

  it("getDatabaseEnv succeeds on a fully populated env", () => {
    stubEnv();
    expect(getDatabaseEnv().DATABASE_URL).toBe(VALID.DATABASE_URL);
  });

  it("getDatabaseEnv throws when DATABASE_URL is not a postgresql:// URL", () => {
    stubEnv({ DATABASE_URL: "mysql://host/db" });
    expect(() => getDatabaseEnv()).toThrow();
  });

  it("getUpstashEnv throws when UPSTASH_REDIS_REST_TOKEN is empty", () => {
    stubEnv({ UPSTASH_REDIS_REST_TOKEN: "" });
    expect(() => getUpstashEnv()).toThrow();
  });

  // The regression this file exists to guard against: getEnv() used to
  // parse all four vars as one object, so a deployment missing only
  // MAPBOX_TOKEN (the hub-linking feature's credential) 500'd on every
  // route that touched Postgres or Redis, including ones with nothing to
  // do with Mapbox — see /api/feed and /api/_latency. Each getter must
  // validate and fail independently of the others.
  it("a missing MAPBOX_TOKEN does not break getDatabaseEnv or getUpstashEnv", () => {
    stubEnv({ MAPBOX_TOKEN: "" });

    expect(() => getMapboxEnv()).toThrow();
    expect(() => getDatabaseEnv()).not.toThrow();
    expect(() => getUpstashEnv()).not.toThrow();
  });

  it("getEnv still validates everything when a caller wants it all at once", () => {
    stubEnv({ MAPBOX_TOKEN: "" });
    expect(() => getEnv()).toThrow();
  });

  it("getGooglePlacesEnv succeeds independently of the other three", () => {
    stubEnv({ MAPBOX_TOKEN: "" });
    expect(() => getMapboxEnv()).toThrow();
    expect(getGooglePlacesEnv().GOOGLE_PLACES_API_KEY).toBe(VALID.GOOGLE_PLACES_API_KEY);
  });

  it("each getter caches independently, so a later fix to one var doesn't require re-reading the others", () => {
    stubEnv({ MAPBOX_TOKEN: "" });
    expect(() => getMapboxEnv()).toThrow();
    expect(getDatabaseEnv().DATABASE_URL).toBe(VALID.DATABASE_URL);

    vi.stubEnv("MAPBOX_TOKEN", "now-set");
    // Still cached as unset internally only for the failed getter — a fresh
    // call re-validates against the now-fixed process.env since the failed
    // parse never populated the cache.
    expect(getMapboxEnv().MAPBOX_TOKEN).toBe("now-set");
  });
});
