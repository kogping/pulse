import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDepartureRows,
  checkStaleness,
  computeBundleMode,
  expandServiceDays,
  isBoardable,
  isServiceActiveSoon,
  normalizeGtfsTime,
  parseCalendarRow,
  parseCsvHeader,
  parseGtfsTable,
  parseStopRow,
  parseTripRow,
  preferredMode,
  routeTypeToMode,
  selectHubStops,
  splitCsvLine,
  type ImportRunSummary,
  type ServiceCalendar,
  type TripInfo,
} from "./parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../../../test/fixtures/gtfs/static-sydneytrains-subset");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

describe("splitCsvLine / parseCsvHeader", () => {
  it("splits quoted, comma-separated fields", () => {
    expect(splitCsvLine('"a","b, with comma","c""quoted"""')).toEqual(["a", "b, with comma", 'c"quoted"']);
  });

  it("parses the real stops.txt header", () => {
    const header = parseCsvHeader(readFixture("stops.txt").split("\n")[0]!);
    expect(header).toEqual([
      "stop_id",
      "stop_code",
      "stop_name",
      "stop_desc",
      "stop_lat",
      "stop_lon",
      "zone_id",
      "stop_url",
      "location_type",
      "parent_station",
      "stop_timezone",
      "wheelchair_boarding",
    ]);
  });
});

describe("parseGtfsTable against fixtures", () => {
  it("parses stops.txt into row objects keyed by header", () => {
    const rows = parseGtfsTable(readFixture("stops.txt"));
    expect(rows.length).toBe(199); // 200 lines - 1 header
    const albury = rows.find((r) => r.stop_id === "26401");
    expect(albury?.stop_name).toBe("Albury Station");
    expect(albury?.location_type).toBe("1");
  });

  it("parses routes.txt", () => {
    const rows = parseGtfsTable(readFixture("routes.txt"));
    const t8 = rows.find((r) => r.route_id === "APS_1a");
    expect(t8?.route_short_name).toBe("T8");
    expect(t8?.route_type).toBe("2");
  });
});

describe("selectHubStops", () => {
  it("selects a parent station within radius and maps its children to it", () => {
    const rows = parseGtfsTable(readFixture("stops.txt")).map(parseStopRow);
    // Fixture stops are Albury-area, not a launch precinct — pass Albury's
    // own coordinates as the "centroid" to exercise real fixture rows
    // without inventing fake precinct data (docs/spikes/tfnsw.md caveat:
    // this subset is head-truncated and not precinct-scoped).
    const centroid = { name: "test", lat: -36.0840679993, lng: 146.924691003 };
    const { hubs, stopIdToHub } = selectHubStops(rows, [centroid], 500);

    expect(hubs.get("26401")).toEqual({
      gtfsStopId: "26401",
      name: "Albury Station",
      lat: -36.0840679993,
      lng: 146.924691003,
    });
    expect(stopIdToHub.get("264086")).toBe("26401"); // child platform -> parent hub
    expect(stopIdToHub.get("26401")).toBe("26401"); // hub resolves to itself
  });

  it("excludes stops outside the radius", () => {
    const rows = parseGtfsTable(readFixture("stops.txt")).map(parseStopRow);
    const farAway = { name: "far", lat: -33.8975, lng: 151.1795 }; // Newtown, nowhere near Albury
    const { hubs } = selectHubStops(rows, [farAway], 800);
    expect(hubs.size).toBe(0);
  });

  it("does not treat a child stop as its own hub", () => {
    const rows = parseGtfsTable(readFixture("stops.txt")).map(parseStopRow);
    const centroid = { name: "test", lat: -36.0840679993, lng: 146.924691003 };
    const { hubs } = selectHubStops(rows, [centroid], 500);
    expect(hubs.has("264086")).toBe(false);
  });
});

describe("parseCalendarRow / isServiceActiveSoon", () => {
  it("builds a bit0=Sunday..bit6=Saturday mask from the real header order", () => {
    // "435.179.100": mon=1,tue=0,wed=0,thu=1,fri=1,sat=0,sun=0
    const raw = parseGtfsTable(readFixture("calendar.txt")).find((r) => r.service_id === "435.179.100")!;
    const calendar = parseCalendarRow(raw);
    // bit1=Mon, bit4=Thu, bit5=Fri
    expect(calendar.serviceDays).toBe((1 << 1) | (1 << 4) | (1 << 5));
  });

  it("is active when the window overlaps the next 7 days", () => {
    const calendar: ServiceCalendar = { serviceId: "s", serviceDays: 0, startDate: "20260804", endDate: "20260807" };
    expect(isServiceActiveSoon(calendar, new Date("2026-08-05T00:00:00Z"))).toBe(true);
  });

  it("is not active once the window has fully passed", () => {
    const calendar: ServiceCalendar = { serviceId: "s", serviceDays: 0, startDate: "20260101", endDate: "20260102" };
    expect(isServiceActiveSoon(calendar, new Date("2026-08-05T00:00:00Z"))).toBe(false);
  });

  it("is not active when the window starts beyond the horizon", () => {
    const calendar: ServiceCalendar = { serviceId: "s", serviceDays: 0, startDate: "20270101", endDate: "20270102" };
    expect(isServiceActiveSoon(calendar, new Date("2026-08-05T00:00:00Z"))).toBe(false);
  });
});

describe("normalizeGtfsTime", () => {
  it("passes through an ordinary same-day time", () => {
    expect(normalizeGtfsTime("05:26:00")).toEqual({ time: "05:26:00", dayOffset: 0 });
  });

  it("wraps a post-midnight time and flags dayOffset=1", () => {
    expect(normalizeGtfsTime("25:10:00")).toEqual({ time: "01:10:00", dayOffset: 1 });
  });

  it("wraps a boundary time of exactly 24:00:00", () => {
    expect(normalizeGtfsTime("24:00:00")).toEqual({ time: "00:00:00", dayOffset: 1 });
  });

  it("throws on more than 2 days past midnight", () => {
    expect(() => normalizeGtfsTime("48:00:00")).toThrow();
  });

  it("throws on malformed input", () => {
    expect(() => normalizeGtfsTime("not-a-time")).toThrow();
  });
});

describe("expandServiceDays", () => {
  it("expands same-day services to their own day", () => {
    const mask = (1 << 0) | (1 << 5); // Sunday, Friday
    expect(expandServiceDays(mask, 0).sort()).toEqual([0, 5]);
  });

  it("shifts post-midnight services forward a day, wrapping Saturday to Sunday", () => {
    const mask = 1 << 6; // Saturday
    expect(expandServiceDays(mask, 1)).toEqual([0]);
  });
});

describe("isBoardable", () => {
  it("excludes pickup_type 1 (no pickup / deadhead runs)", () => {
    expect(isBoardable("1")).toBe(false);
  });

  it("includes 0, empty, 2 and 3", () => {
    expect(isBoardable("0")).toBe(true);
    expect(isBoardable("")).toBe(true);
    expect(isBoardable("2")).toBe(true);
    expect(isBoardable("3")).toBe(true);
  });
});

describe("routeTypeToMode / preferredMode", () => {
  it("maps basic GTFS route_type codes to our mode enum", () => {
    expect(routeTypeToMode("2")).toBe("train");
    expect(routeTypeToMode("3")).toBe("bus");
    expect(routeTypeToMode("4")).toBe("ferry");
    expect(routeTypeToMode("99")).toBeNull();
  });

  it("maps the extended route_type codes TfNSW actually serves", () => {
    // Verified against the live bundles: sydneytrains uses basic "2" but
    // metro/buses/light rail use Google's extended enumeration.
    expect(routeTypeToMode("401")).toBe("metro"); // metro
    expect(routeTypeToMode("700")).toBe("bus"); // buses
    expect(routeTypeToMode("900")).toBe("light_rail"); // both light rail lines
  });

  it("prefers the richer mode on conflict", () => {
    expect(preferredMode("bus", "train")).toBe("train");
    expect(preferredMode("train", "metro")).toBe("metro");
    expect(preferredMode("ferry", "bus")).toBe("ferry");
  });
});

describe("computeBundleMode", () => {
  it("returns the most common non-null mode", () => {
    expect(computeBundleMode(["train", "train", "bus", null])).toBe("train");
  });

  it("returns null for an all-null bundle", () => {
    expect(computeBundleMode([null, null])).toBeNull();
  });
});

describe("buildDepartureRows", () => {
  const stopIdToHub = new Map([["264086", "26401"]]);
  const trips = new Map<string, TripInfo>([
    ["trip-1", { routeId: "APS_1a", serviceId: "svc-1", directionId: "0", tripHeadsign: "City Circle" }],
  ]);
  const routes = new Map([["APS_1a", { routeShortName: "T8" }]]);
  const activeCalendars = new Map<string, ServiceCalendar>([
    ["svc-1", { serviceId: "svc-1", serviceDays: 1 << 5, startDate: "20260804", endDate: "20260807" }], // Friday
  ]);

  it("produces a departure row for a valid, boardable, hub stop_time", () => {
    const rows = buildDepartureRows(
      { stopId: "264086", tripId: "trip-1", arrivalTime: "18:30:00", pickupType: "0" },
      stopIdToHub,
      trips,
      routes,
      activeCalendars,
    );
    expect(rows).toEqual([
      {
        hubStopId: "26401",
        route: "T8",
        headsign: "City Circle",
        direction: 0,
        dayOfWeek: 5,
        scheduledTime: "18:30:00",
        serviceDays: 1 << 5,
        gtfsTripId: "trip-1",
      },
    ]);
  });

  it("shifts the day forward for a post-midnight departure", () => {
    const rows = buildDepartureRows(
      { stopId: "264086", tripId: "trip-1", arrivalTime: "25:10:00", pickupType: "0" },
      stopIdToHub,
      trips,
      routes,
      activeCalendars,
    );
    expect(rows[0]?.scheduledTime).toBe("01:10:00");
    expect(rows[0]?.dayOfWeek).toBe(6); // Friday (5) + 1 day offset
  });

  it("drops unboardable rows", () => {
    const rows = buildDepartureRows(
      { stopId: "264086", tripId: "trip-1", arrivalTime: "18:30:00", pickupType: "1" },
      stopIdToHub,
      trips,
      routes,
      activeCalendars,
    );
    expect(rows).toEqual([]);
  });

  it("drops rows for a stop that isn't a hub", () => {
    const rows = buildDepartureRows(
      { stopId: "not-a-hub-stop", tripId: "trip-1", arrivalTime: "18:30:00", pickupType: "0" },
      stopIdToHub,
      trips,
      routes,
      activeCalendars,
    );
    expect(rows).toEqual([]);
  });

  it("drops rows for a trip/service/route that isn't known or active", () => {
    const base = { stopId: "264086", arrivalTime: "18:30:00", pickupType: "0" };
    expect(buildDepartureRows({ ...base, tripId: "unknown-trip" }, stopIdToHub, trips, routes, activeCalendars)).toEqual([]);
  });
});

describe("checkStaleness", () => {
  const now = new Date("2026-08-05T00:00:00Z");
  const expectedSources = ["sydneytrains", "buses"];

  function run(status: ImportRunSummary["status"], finishedAt: Date | null): ImportRunSummary {
    return { source: "sydneytrains", status, finishedAt };
  }

  it("is fresh when every expected source succeeded within 10 days", () => {
    const map = new Map<string, ImportRunSummary>([
      ["sydneytrains", run("succeeded", new Date("2026-08-01T00:00:00Z"))],
      ["buses", run("skipped", new Date("2026-08-04T00:00:00Z"))],
    ]);
    expect(checkStaleness(map, expectedSources, now)).toEqual({ stale: false, staleSources: [] });
  });

  it("flags a source last successful more than 10 days ago", () => {
    const map = new Map<string, ImportRunSummary>([
      ["sydneytrains", run("succeeded", new Date("2026-07-20T00:00:00Z"))],
      ["buses", run("succeeded", new Date("2026-08-04T00:00:00Z"))],
    ]);
    expect(checkStaleness(map, expectedSources, now)).toEqual({ stale: true, staleSources: ["sydneytrains"] });
  });

  it("flags a source that has never run", () => {
    const map = new Map<string, ImportRunSummary>([["buses", run("succeeded", new Date("2026-08-04T00:00:00Z"))]]);
    expect(checkStaleness(map, expectedSources, now).staleSources).toEqual(["sydneytrains"]);
  });

  it("flags a source whose latest run failed", () => {
    const map = new Map<string, ImportRunSummary>([
      ["sydneytrains", run("failed", new Date("2026-08-04T00:00:00Z"))],
      ["buses", run("succeeded", new Date("2026-08-04T00:00:00Z"))],
    ]);
    expect(checkStaleness(map, expectedSources, now).staleSources).toEqual(["sydneytrains"]);
  });
});

describe("parseTripRow", () => {
  it("parses the real trips.txt row shape", () => {
    const raw = parseGtfsTable(readFixture("trips.txt"))[0]!;
    const { tripId, info } = parseTripRow(raw);
    expect(tripId).toBe("1--A.1294.175.112.B.8.90797050");
    expect(info).toEqual({
      routeId: "RTTA_REV",
      serviceId: "1294.175.112",
      directionId: "0",
      tripHeadsign: "Empty Train",
    });
  });
});
