import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "./client";
import { venueHubLinks } from "./schema/venue-hub-links";
import { transitHubs } from "./schema/transit-hubs";
import { mapboxWalkingClient, type LatLng, type WalkingDirectionsClient } from "./mapbox";

export const HUB_SEARCH_RADIUS_METERS = 1500;
export const MAX_HUBS_PER_VENUE = 5;
// Straight-line-distance fallback speed when Mapbox is unavailable, per spec.
const STRAIGHT_LINE_WALK_SPEED_MPS = 1.35;
// A hub counts as having "meaningful late-night service" if it has at least
// one scheduled departure from 9pm through 2am — timed for people leaving a
// venue, not just the last commuter train home. Matches the evening/late
// window scripts/gtfs-import.ts's weekly timetable import populates.
const LATE_NIGHT_FROM = "21:00:00";
const LATE_NIGHT_UNTIL = "02:00:00";

export interface HubCandidate {
  hubId: string;
  location: LatLng;
  /** Whether this hub has at least one scheduled departure in the late-night window. */
  hasLateNightService: boolean;
}

export interface HubLinkResult {
  hubId: string;
  walkSeconds: number;
  isPrimary: boolean;
  isEstimated: boolean;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

interface NearestHubRow extends Record<string, unknown> {
  id: string;
  lat: number;
  lng: number;
  hasLateNightService: boolean;
}

// The N nearest transit hubs to `location` within HUB_SEARCH_RADIUS_METERS,
// using the GiST index on transit_hubs.location for KNN ordering (`<->`).
// Not unit tested directly (needs a real Postgres + PostGIS instance, which
// this package's test suite doesn't run against) — computeVenueHubLinks
// below, which does the actual walk-time/primary-selection logic, takes
// pre-fetched candidates so it can be tested without a DB.
export async function findNearestHubCandidates(
  location: LatLng,
  limit: number = MAX_HUBS_PER_VENUE,
): Promise<HubCandidate[]> {
  const point = drizzleSql`ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography`;
  const result = await db.execute<NearestHubRow>(drizzleSql`
    SELECT
      th.id,
      ST_Y(th.location::geometry) AS lat,
      ST_X(th.location::geometry) AS lng,
      EXISTS (
        SELECT 1 FROM scheduled_departures sd
        WHERE sd.transit_hub_id = th.id
          AND (sd.scheduled_time >= ${LATE_NIGHT_FROM} OR sd.scheduled_time <= ${LATE_NIGHT_UNTIL})
      ) AS has_late_night_service
    FROM transit_hubs th
    WHERE ST_DWithin(th.location, ${point}, ${HUB_SEARCH_RADIUS_METERS})
    ORDER BY th.location <-> ${point}
    LIMIT ${limit}
  `);

  return result.rows.map((row) => ({
    hubId: row.id,
    location: { lat: row.lat, lng: row.lng },
    hasLateNightService: row.hasLateNightService,
  }));
}

// Pure(ish) core of the linking logic: resolves a walk time for each
// candidate hub (Mapbox Directions, falling back to straight-line distance
// on any failure) and picks exactly one primary — the lowest walk time
// among hubs with meaningful late-night service, or the lowest walk time
// overall if none of the candidates run late. Takes hub candidates and the
// walking client as parameters (rather than querying/importing them itself)
// so it's testable without a database or network — see hub-links.test.ts.
export async function computeVenueHubLinks(
  venueLocation: LatLng,
  hubs: readonly HubCandidate[],
  client: WalkingDirectionsClient = mapboxWalkingClient,
): Promise<HubLinkResult[]> {
  if (hubs.length === 0) return [];

  const resolved = await Promise.all(
    hubs.map(async (hub) => {
      try {
        const walkSeconds = await client.walkSeconds(venueLocation, hub.location);
        return { hub, walkSeconds, isEstimated: false };
      } catch {
        const meters = haversineMeters(venueLocation, hub.location);
        const walkSeconds = Math.round(meters / STRAIGHT_LINE_WALK_SPEED_MPS);
        return { hub, walkSeconds, isEstimated: true };
      }
    }),
  );

  const lateNightPool = resolved.filter((r) => r.hub.hasLateNightService);
  const primaryPool = lateNightPool.length > 0 ? lateNightPool : resolved;
  const primary = primaryPool.reduce((best, r) => (r.walkSeconds < best.walkSeconds ? r : best));

  return resolved.map((r) => ({
    hubId: r.hub.hubId,
    walkSeconds: r.walkSeconds,
    isPrimary: r.hub.hubId === primary.hub.hubId,
    isEstimated: r.isEstimated,
  }));
}

// Onboarding-time entry point (F-Transport-hub-linking): call on venue
// create, and on venue move (see apps/console/lib/venue-store.ts). Replaces
// the venue's entire link set rather than diffing row-by-row — the
// candidate hub set itself can change (a closer hub may now be in range),
// so recomputing from scratch is simpler than reconciling adds/removes/
// is_primary flips. Never throws on a Mapbox failure (that's handled inside
// computeVenueHubLinks via the estimated fallback); a caller should still
// wrap this in a try/catch for DB-level failures, matching
// invalidateFeedCache's best-effort contract, so a hub-linking problem can
// never fail a venue save.
export async function linkVenueToNearestHubs(
  venueId: string,
  venueLocation: LatLng,
  client: WalkingDirectionsClient = mapboxWalkingClient,
): Promise<HubLinkResult[]> {
  const hubs = await findNearestHubCandidates(venueLocation);
  const links = await computeVenueHubLinks(venueLocation, hubs, client);

  await db.delete(venueHubLinks).where(eq(venueHubLinks.venueId, venueId));
  if (links.length > 0) {
    await db.insert(venueHubLinks).values(
      links.map((link) => ({
        venueId,
        transitHubId: link.hubId,
        walkSeconds: link.walkSeconds,
        isPrimary: link.isPrimary,
        isEstimated: link.isEstimated,
      })),
    );
  }

  return links;
}

export interface PrimaryHubForVenue {
  hubId: string;
  hubName: string;
  gtfsStopId: string | null;
  walkSeconds: number;
}

// F3's read path: the one hub a venue's transport slot renders (F2/F3
// invariant — a venue shows exactly one countdown, not a list of every
// nearby hub). A venue with no linked hubs (never onboarded, or the
// onboarding-time search in findNearestHubCandidates found nothing in
// range) returns null, and the transport slot renders nothing rather than
// a broken state.
export async function getPrimaryHubForVenue(venueId: string): Promise<PrimaryHubForVenue | null> {
  const [row] = await db
    .select({
      hubId: transitHubs.id,
      hubName: transitHubs.name,
      gtfsStopId: transitHubs.gtfsStopId,
      walkSeconds: venueHubLinks.walkSeconds,
    })
    .from(venueHubLinks)
    .innerJoin(transitHubs, eq(transitHubs.id, venueHubLinks.transitHubId))
    .where(and(eq(venueHubLinks.venueId, venueId), eq(venueHubLinks.isPrimary, true)))
    .limit(1);

  return row ?? null;
}

export interface TransitHubSummary {
  id: string;
  name: string;
  mode: string;
  gtfsStopId: string | null;
}

// F3's route handler needs the hub's mode (to pick a GTFS-R feed) and
// gtfs_stop_id (to filter that feed's trip updates) — both live on
// transit_hubs, looked up independently of any venue since GET
// /api/transport/[hubId] is keyed by hub, not venue.
export async function getTransitHubById(hubId: string): Promise<TransitHubSummary | null> {
  const [row] = await db
    .select({ id: transitHubs.id, name: transitHubs.name, mode: transitHubs.mode, gtfsStopId: transitHubs.gtfsStopId })
    .from(transitHubs)
    .where(eq(transitHubs.id, hubId))
    .limit(1);

  return row ?? null;
}
