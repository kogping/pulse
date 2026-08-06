// Pure, DB-free, network-free logic for scripts/places-import.ts — grid
// geometry, Google Places result shaping, and CLI arg parsing. Kept
// separate from the entrypoint (same convention as scripts/lib/gtfs/parse.ts)
// so this file can be imported by places-import.test.ts without triggering
// the entrypoint's top-level `main().catch(...)` call.

// Greater Sydney, [minLng, minLat, maxLng, maxLat].
export const DEFAULT_BBOX: [number, number, number, number] = [150.52, -34.17, 151.35, -33.58];
export const CELL_RADIUS_METERS = 1000;
// 1000m-radius circles spaced so adjoining cells overlap slightly rather
// than leaving gaps — a 20-result cap means a cell can miss venues near its
// edge if a denser inner cluster is competing for the same 20 slots.
export const CELL_SPACING_METERS = 1400;
export const MAX_RESULTS_PER_CELL = 20;
export const MAX_SUBDIVISION_DEPTH = 3;
const EARTH_RADIUS_METERS = 6_371_000;

export interface Cell {
  lat: number;
  lng: number;
  radiusMeters: number;
  depth: number;
}

function metersToLatDegrees(meters: number): number {
  return (meters / EARTH_RADIUS_METERS) * (180 / Math.PI);
}

function metersToLngDegrees(meters: number, atLat: number): number {
  return (meters / (EARTH_RADIUS_METERS * Math.cos((atLat * Math.PI) / 180))) * (180 / Math.PI);
}

// Rectangular grid of overlapping circles covering `bbox`. Cheap and
// deterministic — good enough for a periodic backfill; no attempt to skip
// water/parkland, since a wasted request over open water is not much
// waste at this cell count.
export function buildGridCells(bbox: [number, number, number, number]): Cell[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const cells: Cell[] = [];
  const latStep = metersToLatDegrees(CELL_SPACING_METERS);
  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    const lngStep = metersToLngDegrees(CELL_SPACING_METERS, lat);
    for (let lng = minLng; lng <= maxLng; lng += lngStep) {
      cells.push({ lat, lng, radiusMeters: CELL_RADIUS_METERS, depth: 0 });
    }
  }
  return cells;
}

// Recursion trigger for a cell that hit the API's cap — see
// places-import.ts's sweepCell, which is what actually decides whether to
// call this (only when a cell's result count == MAX_RESULTS_PER_CELL and
// cell.depth < MAX_SUBDIVISION_DEPTH).
export function subdivide(cell: Cell): Cell[] {
  const offset = cell.radiusMeters / 2;
  const dLat = metersToLatDegrees(offset);
  const dLng = metersToLngDegrees(offset, cell.lat);
  const quadrants: [number, number][] = [
    [dLat, dLng],
    [dLat, -dLng],
    [-dLat, dLng],
    [-dLat, -dLng],
  ];
  return quadrants.map(([latOffset, lngOffset]) => ({
    lat: cell.lat + latOffset,
    lng: cell.lng + lngOffset,
    radiusMeters: cell.radiusMeters / 2,
    depth: cell.depth + 1,
  }));
}

// ---- Places API (New) result shapes --------------------------------------

export type OpenDay = { day: number; hour: number; minute: number };

export interface PlacePhoto {
  name?: string;
  authorAttributions?: { displayName?: string }[];
}

export interface PlaceResult {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  addressComponents?: { longText?: string; types?: string[] }[];
  regularOpeningHours?: { periods?: { open?: OpenDay; close?: OpenDay }[] };
  businessStatus?: string;
  photos?: PlacePhoto[];
}

const DAY_HOUR_PATTERN = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export interface CandidateHoursRow {
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

// Places periods -> at most one venue_hours row per day, opaque HH:mm
// (venue_hours_venue_day_idx allows only one row per venue+day). A period
// whose close.day differs from open.day naturally yields closesAt <=
// opensAt in the shift's own opening-day frame — the same past-midnight
// convention venue_hours already uses (see venue-input.ts's
// hoursSpanMidnight), so no separate midnight-crossing logic is needed here.
//
// A day can have multiple periods (e.g. a restaurant's lunch + dinner
// service) — this is a "what's good tonight" feed, so when a day has more
// than one period we keep the latest-opening one (the evening service) and
// drop the rest, rather than spanning open->close across the gap, which
// would falsely claim the venue is open through the afternoon lull.
export function toHoursRows(periods: { open?: OpenDay; close?: OpenDay }[]): CandidateHoursRow[] {
  const byDay = new Map<number, CandidateHoursRow>();
  for (const period of periods) {
    if (!period.open || !period.close) continue;
    const row: CandidateHoursRow = {
      dayOfWeek: period.open.day,
      isClosed: false,
      opensAt: DAY_HOUR_PATTERN(period.open.hour, period.open.minute),
      closesAt: DAY_HOUR_PATTERN(period.close.hour, period.close.minute),
    };
    const existing = byDay.get(row.dayOfWeek);
    if (!existing || row.opensAt! > existing.opensAt!) byDay.set(row.dayOfWeek, row);
  }
  return [...byDay.values()];
}

export function suburbFromAddressComponents(components: PlaceResult["addressComponents"]): string | null {
  const locality = components?.find((c) => c.types?.includes("locality"));
  if (locality?.longText) return locality.longText;
  const sublocality = components?.find((c) => c.types?.includes("sublocality"));
  return sublocality?.longText ?? null;
}

export interface CandidateVenue {
  externalPlaceId: string;
  name: string;
  precinct: string;
  lat: number;
  lng: number;
  hours: CandidateHoursRow[];
  // Google Places photo resource name + attribution, taken from the first
  // photo Places returns for this place. Null when Places has no photo —
  // never fabricated (invariant: degrade honestly applied to media, not
  // just badge values).
  photoRef: string | null;
  photoAttribution: string | null;
}

// businessStatus check first: a closed-down place must never surface, even
// if the rest of its payload is otherwise well-formed (invariant: degrade
// honestly applied to venue existence, not just badge values).
export function toCandidate(place: PlaceResult): CandidateVenue | null {
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") return null;
  const name = place.displayName?.text;
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!name || lat === undefined || lng === undefined) return null;

  const precinct = suburbFromAddressComponents(place.addressComponents) ?? "Sydney";
  const periods = place.regularOpeningHours?.periods ?? [];
  const photo = place.photos?.[0];

  return {
    externalPlaceId: place.id,
    name,
    precinct,
    lat,
    lng,
    hours: toHoursRows(periods),
    photoRef: photo?.name ?? null,
    photoAttribution: photo?.authorAttributions?.[0]?.displayName ?? null,
  };
}

// ---- CLI args -------------------------------------------------------------

export interface Args {
  dryRun: boolean;
  bbox: [number, number, number, number];
  maxRequests: number;
}

export function parseArgs(argv: string[]): Args {
  const bboxArg = argv.find((a) => a.startsWith("--bbox="));
  const bbox = bboxArg
    ? (bboxArg
        .slice("--bbox=".length)
        .split(",")
        .map(Number) as [number, number, number, number])
    : DEFAULT_BBOX;
  if (bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
    throw new Error("--bbox must be minLng,minLat,maxLng,maxLat");
  }

  const maxRequestsArg = argv.find((a) => a.startsWith("--max-requests="));
  const maxRequests = maxRequestsArg ? Number(maxRequestsArg.slice("--max-requests=".length)) : 4000;

  return { dryRun: argv.includes("--dry-run"), bbox, maxRequests };
}
