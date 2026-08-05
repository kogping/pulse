// Pure parsing/selection logic for the weekly GTFS static import
// (scripts/gtfs-import.ts). No I/O here — kept separate so it can be unit
// tested against the fixtures in test/fixtures/gtfs/ without a network
// connection or a database. See scripts/lib/gtfs/load.ts for the DB side.

export type TransitMode = "train" | "metro" | "light_rail" | "ferry" | "bus";

// Precedence for resolving a hub whose stop_id appears in more than one
// mode bundle (interchanges like Central or Town Hall) — the richer mode
// wins so e.g. a bus bundle can never downgrade a train hub.
const MODE_PRECEDENCE: Record<TransitMode, number> = {
  metro: 5,
  train: 4,
  light_rail: 3,
  ferry: 2,
  bus: 1,
};

// GTFS route_type -> our mode enum (routes.txt). TfNSW bundles mix the
// basic GTFS enum (0-7) with Google's "extended" route types
// (https://developers.google.com/transit/gtfs/reference/extended-route-types)
// — confirmed against the live bundles: sydneytrains uses basic "2",
// ferries basic "4", but metro is extended "401", buses "700", and light
// rail "900". Both scales are handled by range rather than hand-listing
// every extended sub-code (e.g. 701-716 bus subtypes).
const BASIC_ROUTE_TYPE_TO_MODE: Record<string, TransitMode> = {
  "0": "light_rail",
  "1": "metro",
  "2": "train",
  "3": "bus",
  "4": "ferry",
};

export function routeTypeToMode(routeType: string): TransitMode | null {
  const basic = BASIC_ROUTE_TYPE_TO_MODE[routeType];
  if (basic) return basic;

  const code = Number(routeType);
  if (Number.isNaN(code)) return null;
  if (code >= 100 && code <= 199) return "train"; // extended rail
  if (code >= 400 && code <= 499) return "metro"; // extended urban/metro railway
  if (code >= 700 && code <= 799) return "bus"; // extended bus
  if (code >= 900 && code <= 999) return "light_rail"; // extended tram
  if (code >= 1000 && code <= 1099) return "ferry"; // extended water transport
  return null;
}

export function preferredMode(a: TransitMode, b: TransitMode): TransitMode {
  return MODE_PRECEDENCE[a] >= MODE_PRECEDENCE[b] ? a : b;
}

// Each TfNSW static bundle is a single-operator, single-mode endpoint (e.g.
// /v1/gtfs/schedule/sydneytrains is trains only), so hub mode only needs
// bundle-level granularity — the per-stop_time route detail feeds
// scheduled_departures.route directly instead. Falls back to the most
// common mode observed, in case a bundle ever turns out mixed.
export function computeBundleMode(modes: readonly (TransitMode | null)[]): TransitMode | null {
  const counts = new Map<TransitMode, number>();
  for (const mode of modes) {
    if (!mode) continue;
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  let best: TransitMode | null = null;
  let bestCount = 0;
  for (const [mode, count] of counts) {
    if (count > bestCount) {
      best = mode;
      bestCount = count;
    }
  }
  return best;
}

// --- CSV ---------------------------------------------------------------

// GTFS text files are one record per line with no embedded newlines in any
// field (verified against the launch bundles in docs/spikes/tfnsw.md and
// the checked-in fixtures) — so a single-line RFC4180 splitter is enough,
// unlike scripts/import-venues.ts's whole-document parser which has to
// handle newlines inside quoted fields.
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export function parseCsvHeader(line: string): string[] {
  return splitCsvLine(line).map((h) => h.trim());
}

export function rowFromLine(header: readonly string[], line: string): Record<string, string> {
  const cells = splitCsvLine(line);
  const row: Record<string, string> = {};
  header.forEach((col, i) => {
    row[col] = cells[i] ?? "";
  });
  return row;
}

// Parses a small, fully in-memory GTFS table (stops/routes/trips/calendar —
// never stop_times, which is streamed line-by-line by the caller instead).
export function parseGtfsTable(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvHeader(lines[0]!);
  return lines.slice(1).map((line) => rowFromLine(header, line));
}

// --- hub selection -------------------------------------------------------

export interface StopRow {
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  locationType: string;
  parentStation: string;
}

export interface PrecinctCentroid {
  name: string;
  lat: number;
  lng: number;
}

export const HUB_RADIUS_METERS = 800;
const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function parseStopRow(raw: Record<string, string>): StopRow {
  return {
    stopId: raw.stop_id ?? "",
    stopName: raw.stop_name ?? "",
    lat: Number(raw.stop_lat),
    lng: Number(raw.stop_lon),
    locationType: raw.location_type ?? "",
    parentStation: raw.parent_station ?? "",
  };
}

export interface HubCandidate {
  gtfsStopId: string;
  name: string;
  lat: number;
  lng: number;
}

// A stop is "hub-eligible" if it's a parent station (location_type=1) or has
// no parent of its own (location_type="" or "0" with no parent_station) —
// GTFS allows platform-level child stops to sit directly under a parent, or
// a standalone stop (typical for a bus stop) to have no hierarchy at all.
function isHubEligible(stop: StopRow): boolean {
  return stop.locationType === "1" || stop.parentStation === "";
}

// Selects hub stops within HUB_RADIUS_METERS of any precinct centroid, and
// returns a map from every stop_id that should resolve to that hub
// (the hub stop itself, plus any children parented to it) -> the hub's
// GTFS stop_id. stop_times.txt references platform-level child stops, so
// this map is what lets the streamed pass resolve them to a hub.
export function selectHubStops(
  stops: readonly StopRow[],
  centroids: readonly PrecinctCentroid[],
  radiusMeters = HUB_RADIUS_METERS,
): { hubs: Map<string, HubCandidate>; stopIdToHub: Map<string, string> } {
  const hubs = new Map<string, HubCandidate>();
  for (const stop of stops) {
    if (!isHubEligible(stop)) continue;
    if (Number.isNaN(stop.lat) || Number.isNaN(stop.lng)) continue;
    const withinRadius = centroids.some((c) => haversineMeters(c, stop) <= radiusMeters);
    if (!withinRadius) continue;
    hubs.set(stop.stopId, { gtfsStopId: stop.stopId, name: stop.stopName, lat: stop.lat, lng: stop.lng });
  }

  const stopIdToHub = new Map<string, string>();
  for (const hubStopId of hubs.keys()) stopIdToHub.set(hubStopId, hubStopId);
  for (const stop of stops) {
    if (stop.parentStation && hubs.has(stop.parentStation)) {
      stopIdToHub.set(stop.stopId, stop.parentStation);
    }
  }

  return { hubs, stopIdToHub };
}

// --- calendar / service days --------------------------------------------

const CALENDAR_DAY_COLUMNS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export interface ServiceCalendar {
  serviceId: string;
  // 7-bit mask, bit0 = Sunday .. bit6 = Saturday.
  serviceDays: number;
  startDate: string; // YYYYMMDD
  endDate: string; // YYYYMMDD
}

export function parseCalendarRow(raw: Record<string, string>): ServiceCalendar {
  let serviceDays = 0;
  CALENDAR_DAY_COLUMNS.forEach((col, dayOfWeek) => {
    if (raw[col] === "1") serviceDays |= 1 << dayOfWeek;
  });
  return {
    serviceId: raw.service_id ?? "",
    serviceDays,
    startDate: raw.start_date ?? "",
    endDate: raw.end_date ?? "",
  };
}

function parseGtfsDate(date: string): number {
  // YYYYMMDD, lexicographically and numerically comparable as-is.
  return Number(date);
}

// A service is worth importing if its date window overlaps the next 7 days
// from `now` — this is a weekly timetable import, not an archive.
export function isServiceActiveSoon(calendar: ServiceCalendar, now: Date, windowDays = 7): boolean {
  const start = parseGtfsDate(calendar.startDate);
  const end = parseGtfsDate(calendar.endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const today = Number(`${y}${m}${d}`);
  const horizon = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const hy = horizon.getUTCFullYear();
  const hm = String(horizon.getUTCMonth() + 1).padStart(2, "0");
  const hd = String(horizon.getUTCDate()).padStart(2, "0");
  const horizonDate = Number(`${hy}${hm}${hd}`);
  return start <= horizonDate && end >= today;
}

// --- time normalization ---------------------------------------------------

export interface NormalizedTime {
  // "HH:MM:SS" in 00:00:00-23:59:59, safe for a Postgres `time` column.
  time: string;
  // 0 for a same-day departure, 1 if the GTFS hour was >= 24 (a
  // post-midnight service still logged against the previous service day —
  // most of a nightlife app's interesting departures fall here).
  dayOffset: 0 | 1;
}

// Throws on malformed input rather than silently guessing a time — an
// unparseable departure is exactly the kind of "confident wrong number"
// invariant #5 exists to prevent; better to drop the row and log it.
export function normalizeGtfsTime(raw: string): NormalizedTime {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) throw new Error(`malformed GTFS time "${raw}"`);
  const hour = Number(match[1]);
  const minute = match[2];
  const second = match[3];
  if (hour >= 48) throw new Error(`GTFS time "${raw}" is more than 2 days past midnight, unsupported`);
  const dayOffset = hour >= 24 ? 1 : 0;
  const normalizedHour = String(hour >= 24 ? hour - 24 : hour).padStart(2, "0");
  return { time: `${normalizedHour}:${minute}:${second}`, dayOffset };
}

// Expands a service's active-day bitmask into the actual calendar
// day_of_week values departures land on, applying the post-midnight shift
// from normalizeGtfsTime. E.g. a service active on serviceDays bit for
// Friday with dayOffset=1 produces a departure on Saturday.
export function expandServiceDays(serviceDays: number, dayOffset: 0 | 1): number[] {
  const days: number[] = [];
  for (let day = 0; day < 7; day++) {
    if (serviceDays & (1 << day)) days.push((day + dayOffset) % 7);
  }
  return days;
}

// --- stop_times / trips ---------------------------------------------------

export interface TripInfo {
  routeId: string;
  serviceId: string;
  directionId: string;
  tripHeadsign: string;
}

export function parseTripRow(raw: Record<string, string>): { tripId: string; info: TripInfo } {
  return {
    tripId: raw.trip_id ?? "",
    info: {
      routeId: raw.route_id ?? "",
      serviceId: raw.service_id ?? "",
      directionId: raw.direction_id ?? "",
      tripHeadsign: raw.trip_headsign ?? "",
    },
  };
}

// GTFS pickup_type: 0/empty = regularly scheduled, 1 = no pickup available
// (deadhead/empty-train runs), 2 = phone the agency, 3 = coordinate with
// the driver. Only 1 means "not a real boarding opportunity" — showing it
// as a departure would be exactly the wrong-countdown invariant #5 bans.
export function isBoardable(pickupType: string): boolean {
  return pickupType !== "1";
}

export interface StagedDeparture {
  hubStopId: string;
  route: string; // route_short_name
  headsign: string | null;
  direction: number | null;
  dayOfWeek: number;
  scheduledTime: string;
  serviceDays: number;
  gtfsTripId: string;
}

export interface BuildDeparturesInput {
  stopId: string;
  tripId: string;
  arrivalTime: string;
  pickupType: string;
}

// Joins one stop_times row against the maps built from stops/routes/
// calendar/trips into zero or more departure rows (one per active service
// day) ready to stage. Returns [] for rows that should be dropped (not a
// hub stop, unboardable, trip/service missing or inactive).
export function buildDepartureRows(
  input: BuildDeparturesInput,
  stopIdToHub: ReadonlyMap<string, string>,
  trips: ReadonlyMap<string, TripInfo>,
  routes: ReadonlyMap<string, { routeShortName: string }>,
  activeCalendars: ReadonlyMap<string, ServiceCalendar>,
): StagedDeparture[] {
  if (!isBoardable(input.pickupType)) return [];
  const hubStopId = stopIdToHub.get(input.stopId);
  if (!hubStopId) return [];
  const trip = trips.get(input.tripId);
  if (!trip) return [];
  const calendar = activeCalendars.get(trip.serviceId);
  if (!calendar) return [];
  const route = routes.get(trip.routeId);
  if (!route) return [];

  let normalized: NormalizedTime;
  try {
    normalized = normalizeGtfsTime(input.arrivalTime);
  } catch {
    return [];
  }

  const directionId = trip.directionId === "0" || trip.directionId === "1" ? Number(trip.directionId) : null;
  const days = expandServiceDays(calendar.serviceDays, normalized.dayOffset);

  return days.map((dayOfWeek) => ({
    hubStopId,
    route: route.routeShortName,
    headsign: trip.tripHeadsign || null,
    direction: directionId,
    dayOfWeek,
    scheduledTime: normalized.time,
    serviceDays: calendar.serviceDays,
    gtfsTripId: input.tripId,
  }));
}

// --- staleness -------------------------------------------------------------

export interface ImportRunSummary {
  source: string;
  status: "running" | "succeeded" | "skipped" | "failed";
  finishedAt: Date | null;
}

export interface StalenessResult {
  stale: boolean;
  staleSources: string[];
}

// A mode is fresh if its most recent succeeded/skipped run finished within
// maxAgeDays. `runs` should be the latest run per source; the caller (the
// DB query) is responsible for that reduction, not this pure function.
export function checkStaleness(
  latestRunBySource: ReadonlyMap<string, ImportRunSummary | undefined>,
  expectedSources: readonly string[],
  now: Date,
  maxAgeDays = 10,
): StalenessResult {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const staleSources: string[] = [];
  for (const source of expectedSources) {
    const run = latestRunBySource.get(source);
    if (!run || run.status === "failed" || run.status === "running" || !run.finishedAt) {
      staleSources.push(source);
      continue;
    }
    if (now.getTime() - run.finishedAt.getTime() > maxAgeMs) {
      staleSources.push(source);
    }
  }
  return { stale: staleSources.length > 0, staleSources };
}
