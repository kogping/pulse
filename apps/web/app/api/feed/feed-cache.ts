import type { FeedVenue, IntentFilterId } from "@pulse/db";
import { geohashEncode, haversineDistanceMeters } from "./geohash";

// Redis feed cache (CLAUDE.md: "Redis feed cache in Upstash").
//
// Key shape: feed:syd:{geohash5}:{5-min-bucket}:{filter-hash}:v{version}
//   - geohash5 buckets nearby requesters into the same cell so they share a
//     cache entry.
//   - the 5-min bucket is the TTL window.
//   - filter-hash distinguishes radius/limit combinations (it already folds
//     in radiusMeters, so F1.7's wider relaxation rungs get distinct keys
//     for free) and now precinctOnly, so a "this suburb only" request
//     never shares an entry with the default city-wide one.
//   - version is a single global counter (see @pulse/db's
//     bumpFeedCacheVersion): bumping it makes every previously cached key
//     unreachable without a SCAN-and-delete — new reads compute a new key,
//     old keys just expire via TTL. There is no per-precinct key by
//     default — the feed is city-wide (feed.ts's candidateAndOpenNowCte only
//     restricts by precinct when a visitor opts in), so a write anywhere can
//     affect any unrestricted request's candidate set.
//
// The cached payload keeps each venue's raw coordinates (not exposed on the
// public VenueCardData shape) so that after a cache read, results can be
// re-sorted by *exact* distance from the requester's true coordinates —
// the cache only needs to agree on the candidate set and coarse ranking,
// not on which of two nearby requesters a venue is closer to.

export const FEED_CACHE_BUCKET_MS = 5 * 60 * 1000;
export const FEED_CACHE_TTL_SECONDS = 5 * 60;
export const FEED_CACHE_GEOHASH_PRECISION = 5;

export interface FeedCacheRedisClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
}

export interface FeedCacheVenue {
  venue: FeedVenue;
  lat: number;
  lng: number;
}

export type FetchFeedVenues = (params: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  limit?: number;
  now?: Date;
  filters?: IntentFilterId[];
  openNowOnly?: boolean;
  precinctOnly?: boolean;
}) => Promise<FeedCacheVenue[]>;

export interface FeedCacheParams {
  lat: number;
  lng: number;
  radiusMeters?: number;
  limit?: number;
  now?: Date;
  filters?: IntentFilterId[];
  /** F1.8. Folded into the cache key (feedCacheFilterHash) — open-now-only
   *  and open-now-off results differ, so they must never share a key. */
  openNowOnly?: boolean;
  /** Opt-in "this suburb only" restriction (feed.ts's precinctOnly).
   *  Folded into the cache key — a precinct-restricted result set must never
   *  be served to (or written from) a city-wide request, and vice versa. */
  precinctOnly?: boolean;
}

export interface FeedCacheLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export type FeedCacheMetricEvent = "hit" | "miss" | "degraded";

export interface FeedCacheDeps {
  redis: FeedCacheRedisClient;
  fetchVenues: FetchFeedVenues;
  logger?: FeedCacheLogger;
  recordMetric?: (event: FeedCacheMetricEvent) => void;
}

export interface FeedCacheResult {
  venues: FeedVenue[];
  /** Same venue ids as `venues`, keyed to raw coordinates — the one place
   *  outside the cache layer that gets to see them, for the F1.5 map pin
   *  view. Never persisted past this response. */
  locations: Record<string, { lat: number; lng: number }>;
  /** True if a cached result was reused instead of querying Postgres. */
  cacheHit: boolean;
  /** True if Redis was unreachable and the request fell straight through to Postgres. */
  degraded: boolean;
}

const consoleLogger: FeedCacheLogger = {
  warn(message, meta) {
    console.warn(`[feed-cache] ${message}`, meta ?? {});
  },
};

function feedCacheVersionKey(): string {
  return "feed:version:syd";
}

function feedCacheBucket(now: Date): number {
  return Math.floor(now.getTime() / FEED_CACHE_BUCKET_MS);
}

// Small deterministic non-cryptographic hash (djb2-style) — this only needs
// to distinguish filter combinations inside a cache key, not resist attack.
// Intent filter ids are sorted before hashing so ?filters=a,b and
// ?filters=b,a share a cache entry rather than needlessly missing each
// other — order never affects the AND-composed result.
function feedCacheFilterHash(filters: {
  radiusMeters: number;
  limit?: number;
  intentFilters: IntentFilterId[];
  openNowOnly: boolean;
  precinctOnly?: boolean;
}): string {
  const input = `${filters.radiusMeters}:${filters.limit}:${[...filters.intentFilters].sort().join(",")}:${filters.openNowOnly}:${filters.precinctOnly ? "1" : ""}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function buildFeedCacheKey(params: { geohash5: string; bucket: number; filterHash: string; version: number }): string {
  return `feed:syd:${params.geohash5}:${params.bucket}:${params.filterHash}:v${params.version}`;
}

// Upstash's REST client round-trips cached values through JSON, which
// turns every AttributeView's `lastVerifiedAt` Date into a plain string —
// silently, since VenueCardData's TS type still claims it's a Date. Left
// unrevived, that string reaches Badge (packages/ui), which calls
// `.getTime()` on it and throws. Only a cache *hit* goes through JSON at
// all — a cache miss returns Postgres's real Date objects untouched — so
// this only needs to run on the read side.
function reviveCachedVenues(entries: FeedCacheVenue[]): FeedCacheVenue[] {
  return entries.map((entry) => ({
    ...entry,
    venue: {
      ...entry.venue,
      attributes: entry.venue.attributes.map((attribute) =>
        attribute.confidence === "unconfirmed" ? attribute : { ...attribute, lastVerifiedAt: new Date(attribute.lastVerifiedAt) },
      ),
    },
  }));
}

function sortByExactDistance(entries: FeedCacheVenue[], origin: { lat: number; lng: number }, limit?: number): FeedCacheVenue[] {
  const sorted = [...entries].sort(
    (a, b) => haversineDistanceMeters(origin, { lat: a.lat, lng: a.lng }) - haversineDistanceMeters(origin, { lat: b.lat, lng: b.lng }),
  );
  return limit !== undefined ? sorted.slice(0, limit) : sorted;
}

function toResult(
  sorted: FeedCacheVenue[],
  extra: { cacheHit: boolean; degraded: boolean },
): FeedCacheResult {
  return {
    venues: sorted.map((entry) => entry.venue),
    locations: Object.fromEntries(sorted.map((entry) => [entry.venue.id, { lat: entry.lat, lng: entry.lng }])),
    ...extra,
  };
}

// Cache read/write failures fall through to Postgres, never a 500 — see
// CLAUDE.md. `deps.fetchVenues` is the only path that ever hits Postgres;
// everything above it is cache bookkeeping around that one call.
export async function getFeedWithCache(params: FeedCacheParams, deps: FeedCacheDeps): Promise<FeedCacheResult> {
  const { lat, lng, radiusMeters = 2000, limit, filters = [], openNowOnly = true, precinctOnly } = params;
  const now = params.now ?? new Date();
  const logger = deps.logger ?? consoleLogger;
  const recordMetric = deps.recordMetric ?? (() => {});
  const origin = { lat, lng };

  let version: number | null = null;
  try {
    const raw = await deps.redis.get<number | string>(feedCacheVersionKey());
    version = raw ? Number(raw) : 0;
  } catch (error) {
    logger.warn("redis unreachable reading feed version; falling through to Postgres", { error });
  }

  if (version === null) {
    recordMetric("degraded");
    const fresh = await deps.fetchVenues({ lat, lng, radiusMeters, limit, now, filters, openNowOnly, precinctOnly });
    return toResult(sortByExactDistance(fresh, origin, limit), { cacheHit: false, degraded: true });
  }

  const geohash5 = geohashEncode(lat, lng, FEED_CACHE_GEOHASH_PRECISION);
  const bucket = feedCacheBucket(now);
  const filterHash = feedCacheFilterHash({ radiusMeters, limit, intentFilters: filters, openNowOnly, precinctOnly });
  const key = buildFeedCacheKey({ geohash5, bucket, filterHash, version });

  let cached: FeedCacheVenue[] | null = null;
  try {
    cached = await deps.redis.get<FeedCacheVenue[]>(key);
  } catch (error) {
    logger.warn("redis unreachable reading feed cache key; falling through to Postgres", { key, error });
  }

  if (cached) {
    recordMetric("hit");
    return toResult(sortByExactDistance(reviveCachedVenues(cached), origin, limit), { cacheHit: true, degraded: false });
  }

  recordMetric("miss");
  const fresh = await deps.fetchVenues({ lat, lng, radiusMeters, limit, now, filters, openNowOnly, precinctOnly });
  try {
    await deps.redis.set(key, fresh, { ex: FEED_CACHE_TTL_SECONDS });
  } catch (error) {
    logger.warn("redis unreachable writing feed cache key", { key, error });
  }

  return toResult(sortByExactDistance(fresh, origin, limit), { cacheHit: false, degraded: false });
}
