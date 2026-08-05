import { describe, expect, it } from "vitest";
import { computeVenueHubLinks, type HubCandidate } from "./hub-links";
import type { LatLng, WalkingDirectionsClient } from "./mapbox";

const VENUE_LOCATION: LatLng = { lat: -33.8975, lng: 151.1795 };

function hub(overrides: Partial<HubCandidate> & { hubId: string }): HubCandidate {
  return {
    location: { lat: -33.898, lng: 151.18 },
    hasLateNightService: true,
    ...overrides,
  };
}

// Keyed by the destination hub's "lat,lng" so each test can assign a fixed
// walk time per hub without needing a real Directions call.
function fixedClient(secondsByCoord: Record<string, number>): WalkingDirectionsClient {
  return {
    async walkSeconds(_from, to) {
      const key = `${to.lat},${to.lng}`;
      const seconds = secondsByCoord[key];
      if (seconds === undefined) throw new Error(`no fixture for ${key}`);
      return seconds;
    },
  };
}

function alwaysFailingClient(): WalkingDirectionsClient {
  return {
    async walkSeconds() {
      throw new Error("Mapbox Directions failed (500)");
    },
  };
}

describe("computeVenueHubLinks", () => {
  it("returns no rows when there are no candidate hubs", async () => {
    const links = await computeVenueHubLinks(VENUE_LOCATION, [], alwaysFailingClient());
    expect(links).toEqual([]);
  });

  it("produces one row per hub, each with a walkSeconds and exactly one isPrimary", async () => {
    const near = hub({ hubId: "near", location: { lat: -33.898, lng: 151.18 } });
    const far = hub({ hubId: "far", location: { lat: -33.91, lng: 151.19 } });
    const client = fixedClient({
      "-33.898,151.18": 120,
      "-33.91,151.19": 900,
    });

    const links = await computeVenueHubLinks(VENUE_LOCATION, [near, far], client);

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(typeof link.walkSeconds).toBe("number");
      expect(link.walkSeconds).toBeGreaterThan(0);
      expect(link.isEstimated).toBe(false);
    }
    expect(links.filter((l) => l.isPrimary)).toHaveLength(1);
    expect(links.find((l) => l.isPrimary)?.hubId).toBe("near");
  });

  it("recomputes when the venue location (and therefore candidate set) changes", async () => {
    const stationA = hub({ hubId: "station-a", location: { lat: -33.898, lng: 151.18 } });
    const stationB = hub({ hubId: "station-b", location: { lat: -33.91, lng: 151.19 } });

    const beforeMove = await computeVenueHubLinks(
      VENUE_LOCATION,
      [stationA, stationB],
      fixedClient({ "-33.898,151.18": 100, "-33.91,151.19": 800 }),
    );
    expect(beforeMove.find((l) => l.isPrimary)?.hubId).toBe("station-a");

    // Venue moves closer to station-b than station-a: a fresh call with the
    // new candidate set/walk times must flip which hub is primary.
    const afterMove = await computeVenueHubLinks(
      { lat: -33.909, lng: 151.189 },
      [stationA, stationB],
      fixedClient({ "-33.898,151.18": 900, "-33.91,151.19": 90 }),
    );
    expect(afterMove.find((l) => l.isPrimary)?.hubId).toBe("station-b");
  });

  it("falls back to an estimated straight-line walk time when Mapbox fails, without throwing", async () => {
    const near = hub({ hubId: "near", location: { lat: -33.898, lng: 151.18 } });

    const links = await computeVenueHubLinks(VENUE_LOCATION, [near], alwaysFailingClient());

    expect(links).toHaveLength(1);
    expect(links[0]!.isEstimated).toBe(true);
    expect(links[0]!.isPrimary).toBe(true);
    expect(links[0]!.walkSeconds).toBeGreaterThan(0);
  });

  it("only considers hubs with meaningful late-night service for primary, even if a closer hub lacks it", async () => {
    const closeNoLateNight = hub({
      hubId: "close-no-late-night",
      location: { lat: -33.898, lng: 151.18 },
      hasLateNightService: false,
    });
    const fartherWithLateNight = hub({
      hubId: "farther-with-late-night",
      location: { lat: -33.91, lng: 151.19 },
      hasLateNightService: true,
    });
    const client = fixedClient({
      "-33.898,151.18": 60,
      "-33.91,151.19": 600,
    });

    const links = await computeVenueHubLinks(VENUE_LOCATION, [closeNoLateNight, fartherWithLateNight], client);

    expect(links.find((l) => l.isPrimary)?.hubId).toBe("farther-with-late-night");
  });

  it("falls back to the overall lowest walk time when no candidate hub has late-night service", async () => {
    const near = hub({
      hubId: "near",
      location: { lat: -33.898, lng: 151.18 },
      hasLateNightService: false,
    });
    const far = hub({
      hubId: "far",
      location: { lat: -33.91, lng: 151.19 },
      hasLateNightService: false,
    });
    const client = fixedClient({
      "-33.898,151.18": 60,
      "-33.91,151.19": 600,
    });

    const links = await computeVenueHubLinks(VENUE_LOCATION, [near, far], client);

    expect(links.find((l) => l.isPrimary)?.hubId).toBe("near");
  });
});
