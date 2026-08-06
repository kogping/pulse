import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "./client";
import { venueHours, venues } from "./schema";
import type { VenueSource } from "./schema";
import { buildVenueCard, fetchAttributeViewRows, type AttributeView } from "./provenance";

const SYDNEY_TZ = "Australia/Sydney";
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Sydney-local day-of-week for `date`, matching venue_hours.day_of_week
// (0 = Sunday .. 6 = Saturday). A standalone copy of feed.ts's
// sydneyParts — that function also derives minutes-of-day for the open-now
// exclusion, which this read path doesn't need.
function sydneyDayOfWeek(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: SYDNEY_TZ, weekday: "short" }).format(date);
  const dayOfWeek = WEEKDAY_INDEX[weekday];
  if (dayOfWeek === undefined) throw new Error(`sydneyDayOfWeek: unrecognised weekday "${weekday}"`);
  return dayOfWeek;
}

function timeStringToMinutes(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

// 24h "HH:mm" (the column's storage shape) to a visitor-facing 12h clock string.
export function formatClockTime(hhmm: string): string {
  const [h = "0", m = "0"] = hhmm.split(":");
  const hour24 = Number(h);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${m} ${period}`;
}

// Discriminated so a caller can't render a close time for a venue that's
// shut tonight (CLAUDE.md invariant #5: degrade honestly).
export type TonightHours =
  | { isOpenTonight: true; closesAt: string; spansMidnight: boolean }
  | { isOpenTonight: false };

export interface VenueDetailData {
  id: string;
  name: string;
  precinct: string;
  source: VenueSource;
  curatorPitch: string | null;
  lat: number;
  lng: number;
  attributes: AttributeView[];
  tonight: TonightHours;
}

// The public read path for the venue detail view (F2.1-F2.4). Attributes
// come back exclusively as AttributeView badges via buildVenueCard, same as
// getVenueForCard/getFeedVenues — there is no path from this function's
// return value back to a bare venue_attributes value.
export async function getVenueDetail(venueId: string, now: Date = new Date()): Promise<VenueDetailData | null> {
  const [venue] = await db
    .select({
      id: venues.id,
      name: venues.name,
      precinct: venues.precinct,
      source: venues.source,
      curatorPitch: venues.curatorPitch,
      lat: drizzleSql<number>`ST_Y(${venues.location}::geometry)`,
      lng: drizzleSql<number>`ST_X(${venues.location}::geometry)`,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  if (!venue) return null;

  const dayOfWeek = sydneyDayOfWeek(now);
  const [hoursRow] = await db
    .select({ opensAt: venueHours.opensAt, closesAt: venueHours.closesAt, isClosed: venueHours.isClosed })
    .from(venueHours)
    .where(and(eq(venueHours.venueId, venueId), eq(venueHours.dayOfWeek, dayOfWeek)))
    .limit(1);

  const tonight: TonightHours =
    hoursRow && !hoursRow.isClosed && hoursRow.opensAt && hoursRow.closesAt
      ? {
          isOpenTonight: true,
          closesAt: formatClockTime(hoursRow.closesAt),
          spansMidnight: timeStringToMinutes(hoursRow.closesAt) <= timeStringToMinutes(hoursRow.opensAt),
        }
      : { isOpenTonight: false };

  const attributeRows = await fetchAttributeViewRows([venueId]);
  const { attributes } = buildVenueCard({ ...venue, source: venue.source as VenueSource }, attributeRows, now);

  return {
    id: venue.id,
    name: venue.name,
    precinct: venue.precinct,
    source: venue.source as VenueSource,
    curatorPitch: venue.curatorPitch,
    lat: venue.lat,
    lng: venue.lng,
    attributes,
    tonight,
  };
}
