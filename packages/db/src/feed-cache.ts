// Shared invalidation primitive for the Redis feed cache (apps/web/app/api/
// feed/feed-cache.ts owns the read/write/rank side; this file is the one
// piece every write path — console venue edits, curator attribute
// verifications — needs to import to invalidate a precinct's cached feed.
//
// Invalidation is a per-precinct version counter embedded in the cache key,
// not a SCAN-and-delete: bumping the counter makes every previously-cached
// key for that precinct unreachable (a future read computes a new key with
// the new version), and the orphaned old keys simply expire via their TTL.
// This is O(1) regardless of how many geohash cells/buckets/filter
// combinations are currently cached for that precinct.

export interface FeedCacheVersionClient {
  incr(key: string): Promise<number>;
}

export function feedCacheVersionKey(precinct: string): string {
  return `feed:version:${precinct}`;
}

// Called by any write to venue_hours, venues.status, or venue_attributes for
// `precinct` (CLAUDE.md's Redis feed cache invariant). Best-effort: a caller
// that can't reach Redis should log and move on rather than fail the write
// that triggered it — a stale cache entry self-heals in at most one TTL
// window (5 minutes), which is an acceptable bound per "degrade honestly".
export async function bumpPrecinctFeedCacheVersion(redis: FeedCacheVersionClient, precinct: string): Promise<void> {
  await redis.incr(feedCacheVersionKey(precinct));
}
