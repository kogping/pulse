import { countVenuesPerFilter, getClosingSoonVenues, getFeedVenuesWithLocation, redis, type IntentFilterId } from "@pulse/db";
import { getFeedWithCache, type FeedCacheLogger, type FeedCacheMetricEvent } from "../api/feed/feed-cache";
import { runRelaxationLadder, type RelaxationResult } from "./relaxation";

export interface LoadFeedParams {
  /** Display label only — not used to filter candidates. See
   *  `precinctFilter` for the actual opt-in "this suburb only" restriction. */
  precinct: string;
  lat: number;
  lng: number;
  limit?: number;
  now?: Date;
  filters: IntentFilterId[];
  /** F1.8. Defaults true inside runRelaxationLadder when omitted. */
  openNowOnly?: boolean;
  /** Opt-in restriction to venues in this exact precinct (feed.ts's
   *  `precinctFilter`). Omitted (the default) means city-wide — picking a
   *  precinct only seeds the ranking origin (lat/lng) unless the visitor
   *  has explicitly asked to see this suburb only. */
  precinctFilter?: string;
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
  const { lat, lng, limit, now, filters, openNowOnly, precinctFilter } = params;

  const venueLocations: Record<string, { lat: number; lng: number }> = {};

  const relaxation = await runRelaxationLadder(
    { filters, openNowOnly },
    {
      fetchVenues: async ({ radiusMeters, filters: rungFilters, openNowOnly: rungOpenNowOnly }) => {
        const { venues, locations } = await getFeedWithCache(
          { lat, lng, radiusMeters, limit, now, filters: rungFilters, openNowOnly: rungOpenNowOnly, precinctFilter },
          { redis, fetchVenues: getFeedVenuesWithLocation, logger: deps.logger, recordMetric: deps.recordMetric },
        );
        Object.assign(venueLocations, locations);
        return venues;
      },
      countVenuesPerFilter: ({ radiusMeters, filters: rungFilters }) =>
        countVenuesPerFilter({ lat, lng, radiusMeters, now, filters: rungFilters, precinctFilter }),
      fetchClosingSoon: ({ radiusMeters }) => getClosingSoonVenues({ lat, lng, radiusMeters, limit, now, precinctFilter }),
    },
  );

  return { ...relaxation, venueLocations };
}
