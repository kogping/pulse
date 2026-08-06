import { get } from "@vercel/edge-config";

// Static flags are a closed set; precinct flags are an open, per-precinct
// set of the form `precinct_<id>_enabled`. Both are typed so callers can't
// pass an arbitrary string key.
export type StaticFlagName =
  | "transport_live_enabled"
  | "map_enabled"
  | "accessibility_filter_enabled"
  | "citywide_coverage_enabled";

export type PrecinctFlagName = `precinct_${string}_enabled`;

export type FlagName = StaticFlagName | PrecinctFlagName;

export function precinctFlag(precinctId: string): PrecinctFlagName {
  return `precinct_${precinctId}_enabled`;
}

// Safe default per flag, served whenever Edge Config is unreachable,
// unconfigured, or simply hasn't been given a value for this key yet.
// Transport and accessibility filtering default OFF because a wrong-but-
// confident answer (stale live transport, a filter that hides venues it
// shouldn't) is worse than the feature being absent. Precinct rollout flags
// default OFF for the same reason: an un-launched precinct should stay
// invisible until someone flips it on. The map is default ON — it's a
// client-only affordance with a lazy-loaded dependency, so it degrades to a
// no-op rather than a wrong answer. citywide_coverage_enabled defaults OFF:
// it switches /api/location/resolve from the legacy 2-precinct geofence to
// city-wide resolution (see apps/web/app/api/location/resolve/route.ts) —
// an Edge Config outage must not silently widen coverage past what's been
// deliberately launched.
const STATIC_DEFAULTS: Record<StaticFlagName, boolean> = {
  transport_live_enabled: false,
  map_enabled: true,
  accessibility_filter_enabled: false,
  citywide_coverage_enabled: false,
};

const PRECINCT_FLAG_PATTERN = /^precinct_.+_enabled$/;

function getDefault(name: FlagName): boolean {
  if (name in STATIC_DEFAULTS) {
    return STATIC_DEFAULTS[name as StaticFlagName];
  }
  if (PRECINCT_FLAG_PATTERN.test(name)) {
    return false;
  }
  // Only reachable if a future FlagName variant is added to the type
  // without a matching default here.
  throw new Error(`No default configured for flag "${name}"`);
}

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<FlagName, CacheEntry>();

/**
 * Reads a flag from Vercel Edge Config, backed by a 30s in-process cache so
 * a page that checks several flags doesn't take an Edge Config round trip
 * per flag per request. Never throws: any read failure (missing
 * EDGE_CONFIG, network error, malformed value) resolves to the flag's safe
 * default instead, per CLAUDE.md's "degrade honestly" invariant.
 */
export async function getFlag(name: FlagName): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await readFlag(name);
  cache.set(name, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function readFlag(name: FlagName): Promise<boolean> {
  const fallback = getDefault(name);
  try {
    const raw = await get<unknown>(name);
    return typeof raw === "boolean" ? raw : fallback;
  } catch {
    return fallback;
  }
}

/** Test-only: clears the in-process cache so tests don't leak state across cases. */
export function __resetFlagCacheForTests(): void {
  cache.clear();
}
