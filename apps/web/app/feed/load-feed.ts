import { countVenuesPerFilter, getClosingSoonVenues, getFeedVenuesWithLocation, redis, type IntentFilterId } from "@pulse/db";
import { getFeedWithCache, type FeedCacheLogger, type FeedCacheMetricEvent } from "../api/feed/feed-cache";
import { runRelaxationLadder, type RelaxationResult } from "./relaxation";

export interface LoadFeedParams {
  /** No longer used to filter candidates — the feed is city-wide (see
   *  feed.ts's candidateAndOpenNowCte). Kept on the type because callers
   *  (the feed API route, the page) still carry a display label alongside
   *  lat/lng; loadFeed itself ignores it. */
  precinct: string;
  lat: number;
  lng: number;
  limit?: number;
  now?: Date;
  filters: IntentFilterId[];
}

export interface LoadFeedDeps {
  logger?: FeedCacheLogger;
  recordMetric?: (event: FeedCacheMetricEvent) => void;
}

export interface LoadFeedResult extends RelaxationResult {
  /** Raw coordinates for every venue.venues id, for the F1.5 map pin view.
   *  Not carried on VenueCardData itself — see feed-cache.ts's FeedCacheResult. */
  venueLocations: Record<string, { lat: number; lng: number }>;
}

// Wires the F1.7 relaxation ladder (relaxation.ts, DB-free) to the real
// Postgres/Redis-backed queries (@pulse/db, feed-cache.ts). The one place
// both the API route and the feed page assemble these dependencies, so
// neither can drift on how a rung's radius/filters map onto real reads.
export async function loadFeed(params: LoadFeedParams, deps: LoadFeedDeps = {}): Promise<LoadFeedResult> {
  const { lat, lng, limit, now, filters } = params;

  const venueLocations: Record<string, { lat: number; lng: number }> = {};

  const relaxation = await runRelaxationLadder(
    { filters },
    {
      fetchVenues: async ({ radiusMeters, filters: rungFilters }) => {
        const { venues, locations } = await getFeedWithCache(
          { lat, lng, radiusMeters, limit, now, filters: rungFilters },
          { redis, fetchVenues: getFeedVenuesWithLocation, logger: deps.logger, recordMetric: deps.recordMetric },
        );
        Object.assign(venueLocations, locations);
        return venues;
      },
      countVenuesPerFilter: ({ radiusMeters, filters: rungFilters }) =>
        countVenuesPerFilter({ lat, lng, radiusMeters, now, filters: rungFilters }),
      fetchClosingSoon: ({ radiusMeters }) => getClosingSoonVenues({ lat, lng, radiusMeters, limit, now }),
    },
  );

  return { ...relaxation, venueLocations };
}
