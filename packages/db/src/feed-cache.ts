// Shared invalidation primitive for the Redis feed cache (apps/web/app/api/
// feed/feed-cache.ts owns the read/write/rank side; this file is the one
// piece every write path — console venue edits, curator attribute
// verifications — needs to import to invalidate the cached feed.
//
// Invalidation is a single global version counter embedded in the cache key,
// not a SCAN-and-delete: bumping the counter makes every previously-cached
// key unreachable (a future read computes a new key with the new version),
// and the orphaned old keys simply expire via their TTL. This is O(1)
// regardless of how many geohash cells/buckets/filter combinations are
// currently cached.
//
// This used to be one counter per precinct — the feed is now city-wide
// (candidateAndOpenNowCte no longer filters by precinct, see feed.ts), so a
// write anywhere can affect any request's candidate set and there is no
// longer a narrower scope than "everything" to invalidate correctly.
// City-wide invalidation over-invalidates relative to the old per-precinct
// scheme, but with a 5-minute TTL and Pulse's write volume that's far
// cheaper than per-geohash-cell bookkeeping.

export interface FeedCacheVersionClient {
  incr(key: string): Promise<number>;
}

export function feedCacheVersionKey(): string {
  return "feed:version:syd";
}

// Called by any write to venue_hours, venues.status, or venue_attributes
// (CLAUDE.md's Redis feed cache invariant). Best-effort: a caller that can't
// reach Redis should log and move on rather than fail the write that
// triggered it — a stale cache entry self-heals in at most one TTL window
// (5 minutes), which is an acceptable bound per "degrade honestly".
export async function bumpFeedCacheVersion(redis: FeedCacheVersionClient): Promise<void> {
  await redis.incr(feedCacheVersionKey());
}

/** @deprecated Coverage is city-wide now — the `precinct` argument is
 *  ignored. Kept as a thin delegate so existing call sites (console venue
 *  edits, correction-flag writes) don't need a signature change in this PR;
 *  a follow-up cleanup can drop the parameter at each call site and rename
 *  calls to bumpFeedCacheVersion directly. */
export async function bumpPrecinctFeedCacheVersion(redis: FeedCacheVersionClient, _precinct: string): Promise<void> {
  await bumpFeedCacheVersion(redis);
}
