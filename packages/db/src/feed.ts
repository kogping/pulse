import { sql as drizzleSql } from "drizzle-orm";
import { db } from "./client";
import { buildVenueCard, fetchAttributeViewRows, type VenueCardData } from "./provenance";

// F1.1-F1.4: the core "what's good tonight" query. Never show a venue
// that's closed or about to close (invariant: degrade honestly) — that
// filtering happens once, here, so every surface reading the feed
// inherits it rather than re-deriving it.
export const FEED_CLOSING_BUFFER_MINUTES = 45;

const SYDNEY_TZ = "Australia/Sydney";

// One exported constant so a ranking change is a one-line diff, never a
// query rewrite. `distance` applies to normalised distance (0 = at the
// search centre, 1 = at the edge of the search radius) so it's comparable
// across requests with different radii. `qualityTier` is a curator's
// editorial call, applied as a flat bonus. `freshness` multiplies the
// venue's mean badge-freshness score (1 = all attributes fresh, 0 = all
// unconfirmed) computed from venue_attributes_resolved, so a venue whose
// badges have gone stale sinks in rank even if it's close and well-tiered.
export const FEED_SCORING_WEIGHTS = {
  distance: -4,
  qualityTier: {
    flagship: 2,
    solid: 1,
    hidden_gem: 1.5,
  } as Record<string, number>,
  freshness: 3,
} as const;

export interface VenueHoursInput {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday, matches schema/venue-hours.ts
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

function timeStringToMinutes(time: string): number {
  const [h = "0", m = "0", s = "0"] = time.split(":");
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

// Sydney-local (DST-correct, via the IANA tz database) day-of-week and
// minutes-since-midnight for `date`. Delegates the offset computation to
// Intl rather than hand-rolling AEST/AEDT rules.
function sydneyParts(date: Date): { dayOfWeek: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SYDNEY_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayIndex[byType.weekday ?? ""];
  if (dayOfWeek === undefined) throw new Error(`sydneyParts: unrecognised weekday "${byType.weekday}"`);

  // Some locales render midnight as "24" rather than "00".
  const hour = Number(byType.hour) % 24;
  const minute = Number(byType.minute);
  const second = Number(byType.second);
  return { dayOfWeek, minutesOfDay: hour * 60 + minute + second / 60 };
}

// Canonical TS predicate for "open right now, and not closing within
// `bufferMinutes`" — mirrors openNowSqlCondition() below, used inside
// getFeedVenues's query. Kept pure and DB-free so it's unit- and
// property-testable without a Postgres instance; see feed-exclusion.test.ts.
//
// A venue_hours row can apply to "tonight" in two ways: it's today's row
// (the shift started earlier today, possibly still running into tomorrow
// morning), or it's yesterday's row and its shift crossed midnight into
// this morning. Both are checked; either can make the venue open.
export function isOpenWithBuffer(
  hours: readonly VenueHoursInput[],
  now: Date,
  bufferMinutes: number = FEED_CLOSING_BUFFER_MINUTES,
): boolean {
  const { dayOfWeek: todayDow, minutesOfDay: nowMinutes } = sydneyParts(now);
  const yesterdayDow = (todayDow + 6) % 7;

  for (const row of hours) {
    if (row.isClosed || row.opensAt === null || row.closesAt === null) continue;

    const opensMin = timeStringToMinutes(row.opensAt);
    const closesMin = timeStringToMinutes(row.closesAt);
    // Opaque HH:mm comparison per schema/venue-hours.ts: closesAt <= opensAt
    // means the shift runs past midnight, not that the data is wrong.
    const spansMidnight = closesMin <= opensMin;

    if (row.dayOfWeek === todayDow) {
      const closingMinutes = spansMidnight ? closesMin + 1440 : closesMin;
      if (nowMinutes >= opensMin && nowMinutes + bufferMinutes < closingMinutes) return true;
    }

    if (spansMidnight && row.dayOfWeek === yesterdayDow) {
      // Yesterday's shift, still running into this morning: closesMin is
      // already in today's minute space (e.g. opened 22:00 yesterday,
      // closes 03:00 today).
      if (nowMinutes + bufferMinutes < closesMin) return true;
    }
  }

  return false;
}

// Hand-written SQL port of isOpenWithBuffer's three cases (same-day
// non-midnight shift, same-day midnight-spanning shift still before
// midnight, yesterday's midnight-spanning shift still running this
// morning). Must be kept in sync by hand with isOpenWithBuffer above —
// there is no DB in the test runner to assert them against each other
// directly, so feed-exclusion.test.ts exercises the TS side and this
// mirrors it deliberately clause-for-clause.
//
// Takes `now` as a bound parameter rather than calling Postgres's own
// now() so a caller (the e2e suite, simulating 2:15am against real seed
// data) can drive the query from an arbitrary instant.
function openNowSqlCondition(now: Date, bufferMinutes: number) {
  const localNow = drizzleSql`(${now}::timestamptz AT TIME ZONE ${SYDNEY_TZ})`;
  return drizzleSql`(
    (
      vh.day_of_week = EXTRACT(DOW FROM ${localNow})::int
      AND vh.closes_at > vh.opens_at
      AND ${localNow}::time >= vh.opens_at
      AND ${localNow}::time + interval '1 minute' * ${bufferMinutes} < vh.closes_at
    )
    OR (
      vh.day_of_week = EXTRACT(DOW FROM ${localNow})::int
      AND vh.closes_at <= vh.opens_at
      AND ${localNow}::time >= vh.opens_at
      AND ${localNow}::time + interval '1 minute' * ${bufferMinutes} < vh.closes_at + interval '24 hours'
    )
    OR (
      vh.day_of_week = EXTRACT(DOW FROM (${localNow} - interval '1 day'))::int
      AND vh.closes_at <= vh.opens_at
      AND ${localNow}::time + interval '1 minute' * ${bufferMinutes} < vh.closes_at
    )
  )`;
}

// Renders the FEED_SCORING_WEIGHTS constant into the ORDER BY expression,
// so changing a weight above is the only edit a ranking change ever needs.
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function scoreSqlExpression() {
  const tierCases = Object.entries(FEED_SCORING_WEIGHTS.qualityTier)
    .map(([tier, weight]) => `WHEN ${sqlStringLiteral(tier)} THEN ${weight}`)
    .join(" ");

  return drizzleSql.raw(`(
    ${FEED_SCORING_WEIGHTS.distance} * LEAST(normalised_distance, 1)
    + COALESCE(CASE quality_tier ${tierCases} ELSE 0 END, 0)
    + ${FEED_SCORING_WEIGHTS.freshness} * freshness_score
  )`);
}

export interface GetFeedVenuesParams {
  precinct: string;
  lat: number;
  lng: number;
  /** Search radius in metres. Defaults to 2000 (a comfortable walking radius). */
  radiusMeters?: number;
  limit?: number;
  now?: Date;
}

interface FeedCandidateRow extends Record<string, unknown> {
  id: string;
  name: string;
  precinct: string;
}

// The public read path for a feed page (F1.1-F1.4): venues within
// `radiusMeters` of (lat, lng) in `precinct`, filtered to those open right
// now and not closing within FEED_CLOSING_BUFFER_MINUTES, ranked by
// FEED_SCORING_WEIGHTS, capped at `limit`. Attributes are returned
// exclusively as AttributeView badges (provenance.ts) — there is no path
// from this function's return value back to a bare venue_attributes value.
export async function getFeedVenues(params: GetFeedVenuesParams): Promise<VenueCardData[]> {
  const { precinct, lat, lng, radiusMeters = 2000, limit = 10, now = new Date() } = params;

  const result = await db.execute<FeedCandidateRow>(drizzleSql`
    WITH candidate_venues AS (
      SELECT
        v.id,
        v.name,
        v.precinct,
        v.quality_tier,
        ST_Distance(v.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m
      FROM venues v
      WHERE v.precinct = ${precinct}
        AND ST_DWithin(v.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusMeters})
    ),
    open_now AS (
      SELECT DISTINCT cv.id
      FROM candidate_venues cv
      JOIN venue_hours vh ON vh.venue_id = cv.id
      WHERE vh.is_closed = false
        AND vh.opens_at IS NOT NULL
        AND vh.closes_at IS NOT NULL
        AND ${openNowSqlCondition(now, FEED_CLOSING_BUFFER_MINUTES)}
    ),
    badge_freshness AS (
      SELECT
        var.venue_id,
        AVG(
          CASE var.confidence
            WHEN 'fresh' THEN 1
            WHEN 'ageing' THEN 0.5
            ELSE 0
          END
        ) AS freshness_score
      FROM venue_attributes_resolved var
      WHERE var.venue_id IN (SELECT id FROM candidate_venues)
      GROUP BY var.venue_id
    ),
    scored AS (
      SELECT
        cv.id,
        cv.name,
        cv.precinct,
        cv.quality_tier,
        LEAST(cv.distance_m / NULLIF(${radiusMeters}::float, 0), 1) AS normalised_distance,
        COALESCE(bf.freshness_score, 0.5) AS freshness_score
      FROM candidate_venues cv
      JOIN open_now ON open_now.id = cv.id
      LEFT JOIN badge_freshness bf ON bf.venue_id = cv.id
    )
    SELECT id, name, precinct
    FROM scored
    ORDER BY ${scoreSqlExpression()} DESC
    LIMIT ${limit}
  `);

  const venueRows = result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    precinct: r.precinct,
  }));
  if (venueRows.length === 0) return [];

  const attributeRows = await fetchAttributeViewRows(venueRows.map((v) => v.id));
  return venueRows.map((venue) => buildVenueCard(venue, attributeRows, now));
}
