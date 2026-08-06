import { get } from "@vercel/edge-config";

// A closed set of flags, typed so callers can't pass an arbitrary string key.
export type FlagName = "transport_live_enabled" | "map_enabled" | "accessibility_filter_enabled";

// Safe default per flag, served whenever Edge Config is unreachable,
// unconfigured, or simply hasn't been given a value for this key yet.
// Transport and accessibility filtering default OFF because a wrong-but-
// confident answer (stale live transport, a filter that hides venues it
// shouldn't) is worse than the feature being absent. The map is default
// ON — it's a client-only affordance with a lazy-loaded dependency, so it
// degrades to a no-op rather than a wrong answer.
const DEFAULTS: Record<FlagName, boolean> = {
  transport_live_enabled: false,
  map_enabled: true,
  accessibility_filter_enabled: false,
};

function getDefault(name: FlagName): boolean {
  return DEFAULTS[name];
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
