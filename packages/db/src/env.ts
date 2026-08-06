import { z } from "zod";

// Three independent schemas rather than one combined object. getEnv() used
// to parse all four vars atomically, which meant *any* caller — even one
// that only ever touches Postgres — failed if an unrelated var (e.g.
// MAPBOX_TOKEN, only used by the onboarding-time hub-linking walk lookup)
// was missing or invalid. That took down /api/feed and /api/_latency in a
// deployment that had DATABASE_URL and UPSTASH_* configured correctly but
// not yet MAPBOX_TOKEN — a credential gap in one feature should not be an
// outage for every other one (CLAUDE.md invariant #5, applied to config
// rather than data).
const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .startsWith("postgresql://", "DATABASE_URL must be a postgresql:// connection string"),
});

const upstashEnvSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

const mapboxEnvSchema = z.object({
  MAPBOX_TOKEN: z.string().min(1),
});

const googlePlacesEnvSchema = z.object({
  GOOGLE_PLACES_API_KEY: z.string().min(1),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type UpstashEnv = z.infer<typeof upstashEnvSchema>;
export type MapboxEnv = z.infer<typeof mapboxEnvSchema>;
export type GooglePlacesEnv = z.infer<typeof googlePlacesEnvSchema>;
export type Env = DatabaseEnv & UpstashEnv & MapboxEnv & GooglePlacesEnv;

let databaseCached: DatabaseEnv | undefined;
let upstashCached: UpstashEnv | undefined;
let mapboxCached: MapboxEnv | undefined;
let googlePlacesCached: GooglePlacesEnv | undefined;

// Parsed lazily on first use rather than at module import time — see
// client.ts/redis.ts/mapbox.ts, which each call only the getter for the
// credential they actually need. Next.js's "Collecting page data" build
// step imports every route module (even force-dynamic ones) to analyze it,
// which happens on a machine that intentionally has no real credentials
// (CLAUDE.md: migrations run from GitHub Actions, never a Vercel build
// step) — laziness is what keeps that step from failing the build.
export function getDatabaseEnv(): DatabaseEnv {
  if (!databaseCached) {
    databaseCached = databaseEnvSchema.parse({ DATABASE_URL: process.env.DATABASE_URL });
  }
  return databaseCached;
}

export function getUpstashEnv(): UpstashEnv {
  if (!upstashCached) {
    upstashCached = upstashEnvSchema.parse({
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return upstashCached;
}

export function getMapboxEnv(): MapboxEnv {
  if (!mapboxCached) {
    mapboxCached = mapboxEnvSchema.parse({ MAPBOX_TOKEN: process.env.MAPBOX_TOKEN });
  }
  return mapboxCached;
}

// Only ever called by scripts/places-import.ts (a GitHub Actions job, never
// a Vercel build/request path) — kept as its own narrow getter for the same
// reason as the others above: a missing Places key must fail that one
// script, not any unrelated getEnv() caller.
export function getGooglePlacesEnv(): GooglePlacesEnv {
  if (!googlePlacesCached) {
    googlePlacesCached = googlePlacesEnvSchema.parse({ GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY });
  }
  return googlePlacesCached;
}

// Convenience for a caller that genuinely wants every credential validated
// at once (e.g. a startup health check, or scripts/ run against a fully
// configured environment) — each field's failure domain is still the
// narrow getter above; nothing internal to this package calls this.
export function getEnv(): Env {
  return { ...getDatabaseEnv(), ...getUpstashEnv(), ...getMapboxEnv(), ...getGooglePlacesEnv() };
}

/** Test-only: clears the per-concern caches so tests don't leak state across cases. */
export function __resetEnvCacheForTests(): void {
  databaseCached = undefined;
  upstashCached = undefined;
  mapboxCached = undefined;
  googlePlacesCached = undefined;
}
