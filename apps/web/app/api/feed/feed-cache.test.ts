import { describe, expect, it, vi } from "vitest";
import type { VenueCardData } from "@pulse/db";
import { getFeedWithCache, type FeedCacheRedisClient, type FeedCacheVenue, type FetchFeedVenues } from "./feed-cache";
import { geohashEncode } from "./geohash";

const PRECINCT = "surry-hills";

function venue(id: string): VenueCardData {
  return { id, name: `Venue ${id}`, precinct: PRECINCT, attributes: [] };
}

// In-memory stand-in for the Upstash REST client. `incr` mirrors
// @pulse/db's bumpPrecinctFeedCacheVersion so tests can simulate a
// venue-hours/venue_attributes write invalidating the cache the same way
// production does.
class FakeRedis implements FeedCacheRedisClient {
  private store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }

  async set(key: string, value: unknown): Promise<unknown> {
    this.store.set(key, value);
    return "OK";
  }

  async incr(key: string): Promise<number> {
    const next = ((this.store.get(key) as number | undefined) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }
}

class ThrowingRedis implements FeedCacheRedisClient {
  async get<T>(): Promise<T | null> {
    throw new Error("ECONNREFUSED");
  }
  async set(): Promise<unknown> {
    throw new Error("ECONNREFUSED");
  }
}

function fetchVenuesReturning(entries: FeedCacheVenue[]): FetchFeedVenues {
  return vi.fn(async () => entries);
}

describe("feed cache", () => {
  it("hits the cache on a second identical request within the same bucket", async () => {
    const redis = new FakeRedis();
    const fetchVenues = fetchVenuesReturning([{ venue: venue("a"), lat: -33.88, lng: 151.2 }]);
    const now = new Date("2026-08-05T22:00:00+10:00");
    const request = { precinct: PRECINCT, lat: -33.88, lng: 151.2, now };

    const first = await getFeedWithCache(request, { redis, fetchVenues });
    const second = await getFeedWithCache(request, { redis, fetchVenues });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchVenues).toHaveBeenCalledTimes(1);
    expect(second.venues).toEqual(first.venues);
  });

  it("a venue-hours write invalidates the cache immediately", async () => {
    const redis = new FakeRedis();
    let call = 0;
    const fetchVenues: FetchFeedVenues = vi.fn(async () => {
      call++;
      return call === 1
        ? [{ venue: venue("a"), lat: -33.88, lng: 151.2 }]
        : [{ venue: venue("b"), lat: -33.88, lng: 151.2 }];
    });
    const now = new Date("2026-08-05T22:00:00+10:00");
    const request = { precinct: PRECINCT, lat: -33.88, lng: 151.2, now };

    const before = await getFeedWithCache(request, { redis, fetchVenues });
    expect(before.venues.map((v) => v.id)).toEqual(["a"]);

    // Simulates apps/console's venue-store.ts calling
    // bumpPrecinctFeedCacheVersion after a venue_hours write commits.
    await redis.incr(`feed:version:${PRECINCT}`);

    const after = await getFeedWithCache(request, { redis, fetchVenues });
    expect(fetchVenues).toHaveBeenCalledTimes(2);
    expect(after.cacheHit).toBe(false);
    expect(after.venues.map((v) => v.id)).toEqual(["b"]);
  });

  it("falls through to Postgres and logs a warning on a simulated Redis outage", async () => {
    const redis = new ThrowingRedis();
    const fetchVenues = fetchVenuesReturning([{ venue: venue("a"), lat: -33.88, lng: 151.2 }]);
    const warn = vi.fn();

    const result = await getFeedWithCache(
      { precinct: PRECINCT, lat: -33.88, lng: 151.2 },
      { redis, fetchVenues, logger: { warn } },
    );

    expect(result.degraded).toBe(true);
    expect(result.cacheHit).toBe(false);
    expect(result.venues.map((v) => v.id)).toEqual(["a"]);
    expect(fetchVenues).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("sorts the post-cache result by exact distance for two users in the same geohash cell", async () => {
    const redis = new FakeRedis();
    const userA = { lat: -33.8688, lng: 151.2093 };
    const userB = { lat: -33.8686, lng: 151.2091 };
    // Precondition: the two users really do land in the same geohash-5 cell,
    // so this test is exercising the post-cache re-sort, not just two
    // independent cache entries.
    expect(geohashEncode(userA.lat, userA.lng, 5)).toBe(geohashEncode(userB.lat, userB.lng, 5));

    const nearA = { venue: venue("near-a"), lat: -33.8689, lng: 151.2094 };
    const nearB = { venue: venue("near-b"), lat: -33.8685, lng: 151.209 };
    const fetchVenues = fetchVenuesReturning([nearA, nearB]);

    const now = new Date("2026-08-05T22:00:00+10:00");
    const resultA = await getFeedWithCache({ precinct: PRECINCT, ...userA, now }, { redis, fetchVenues });
    const resultB = await getFeedWithCache({ precinct: PRECINCT, ...userB, now }, { redis, fetchVenues });

    // Both requests land in the same cache cell/bucket/filter — only one
    // Postgres query for the pair — but each gets its own exact-distance
    // ordering back.
    expect(fetchVenues).toHaveBeenCalledTimes(1);
    expect(resultB.cacheHit).toBe(true);
    expect(resultA.venues.map((v) => v.id)).toEqual(["near-a", "near-b"]);
    expect(resultB.venues.map((v) => v.id)).toEqual(["near-b", "near-a"]);
  });
});
