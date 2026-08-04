import { countVenuesPerFilter, getClosingSoonVenues, getFeedVenuesWithLocation, redis, type IntentFilterId } from "@pulse/db";
import { getFeedWithCache, type FeedCacheLogger, type FeedCacheMetricEvent } from "../api/feed/feed-cache";
import { runRelaxationLadder, type RelaxationResult } from "./relaxation";

export interface LoadFeedParams {
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

// Wires the F1.7 relaxation ladder (relaxation.ts, DB-free) to the real
// Postgres/Redis-backed queries (@pulse/db, feed-cache.ts). The one place
// both the API route and the feed page assemble these dependencies, so
// neither can drift on how a rung's radius/filters map onto real reads.
export function loadFeed(params: LoadFeedParams, deps: LoadFeedDeps = {}): Promise<RelaxationResult> {
  const { precinct, lat, lng, limit, now, filters } = params;

  return runRelaxationLadder(
    { filters },
    {
      fetchVenues: async ({ radiusMeters, filters: rungFilters }) => {
        const { venues } = await getFeedWithCache(
          { precinct, lat, lng, radiusMeters, limit, now, filters: rungFilters },
          { redis, fetchVenues: getFeedVenuesWithLocation, logger: deps.logger, recordMetric: deps.recordMetric },
        );
        return venues;
      },
      countVenuesPerFilter: ({ radiusMeters, filters: rungFilters }) =>
        countVenuesPerFilter({ precinct, lat, lng, radiusMeters, now, filters: rungFilters }),
      fetchClosingSoon: ({ radiusMeters }) => getClosingSoonVenues({ precinct, lat, lng, radiusMeters, limit, now }),
    },
  );
}
