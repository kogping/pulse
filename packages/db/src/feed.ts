import { inArray, sql as drizzleSql } from "drizzle-orm";
import { db } from "./client";
import { buildVenueCard, fetchAttributeViewRows, type VenueCardData } from "./provenance";
import { INTENT_FILTER_REGISTRY_BY_ID, NO_COVER_VALUE_TOKENS, type IntentFilterId } from "./intent-filters";
import { venueHours, type VenueSource } from "./schema";

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
  // Curator-authored venues outrank a same-distance, zero-info Places
  // listing (source.google_places is 0 — no bonus, not a penalty; distance
  // and freshness alone already rank it lower). At the fixed 2000m
  // normaliser (DISTANCE_NORMALISER_METERS), 0.8 is worth ~400m of
  // distance, so a Places venue noticeably closer still wins — the ranking
  // stays location-dominant, curation is a tiebreaker at comparable range.
  source: {
    curator: 0.8,
    google_places: 0,
  } as Record<string, number>,
} as const;

// Fixed rather than derived from the request's radiusMeters: F1.7's
// relaxation ladder widens radiusMeters to admit more venues in sparse
// areas, and a normaliser that widened with it would flatten distance's
// contribution to the score exactly when it matters most for ranking
// nearby venues first.
export const DISTANCE_NORMALISER_METERS = 2000;

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

// F1.8: when a visitor toggles "Open now" off, closed and unconfirmed-hours
// venues can appear in the feed too — this is what labels each one honestly
// instead of leaving it looking indistinguishable from an open venue
// (CLAUDE.md invariant #5 applied to feed display, not just live transport).
// Deliberately does NOT apply FEED_CLOSING_BUFFER_MINUTES — that's a
// feed-*inclusion* rule for the default (open-now-only) mode, not a display
// fact about whether a venue happens to be open right now.
export type FeedVenueAvailability =
  | { status: "open"; closesAt: string; spansMidnight: boolean }
  // `opensAt` is set only when the venue opens later *today* — otherwise
  // null, since guessing which future day it next opens would risk showing
  // a confident wrong time (same "silence beats a confident wrong number"
  // principle as CLAUDE.md invariant #5).
  | { status: "closed"; opensAt: string | null }
  // No venue_hours rows at all (typically a scripts/places-import.ts venue
  // never claimed by a curator) — never inferred as open or closed.
  | { status: "unknown" };

export function tonightAvailability(hours: readonly VenueHoursInput[], now: Date): FeedVenueAvailability {
  if (hours.length === 0) return { status: "unknown" };

  const { dayOfWeek: todayDow, minutesOfDay: nowMinutes } = sydneyParts(now);
  const yesterdayDow = (todayDow + 6) % 7;

  const todayRow = hours.find((h) => h.dayOfWeek === todayDow && !h.isClosed && h.opensAt !== null && h.closesAt !== null);
  const yesterdayRow = hours.find(
    (h) => h.dayOfWeek === yesterdayDow && !h.isClosed && h.opensAt !== null && h.closesAt !== null,
  );

  if (todayRow) {
    const opensMin = timeStringToMinutes(todayRow.opensAt!);
    const closesMin = timeStringToMinutes(todayRow.closesAt!);
    const spansMidnight = closesMin <= opensMin;
    const closingMinutes = spansMidnight ? closesMin + 1440 : closesMin;
    if (nowMinutes >= opensMin && nowMinutes < closingMinutes) {
      return { status: "open", closesAt: todayRow.closesAt!, spansMidnight };
    }
    if (nowMinutes < opensMin) {
      return { status: "closed", opensAt: todayRow.opensAt! };
    }
  }

  if (yesterdayRow) {
    const opensMin = timeStringToMinutes(yesterdayRow.opensAt!);
    const closesMin = timeStringToMinutes(yesterdayRow.closesAt!);
    if (closesMin <= opensMin && nowMinutes < closesMin) {
      return { status: "open", closesAt: yesterdayRow.closesAt!, spansMidnight: true };
    }
  }

  return { status: "closed", opensAt: null };
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
      -- Not "vh.closes_at + interval '24 hours'": Postgres's time + interval
      -- wraps modulo 24h (00:00 + 24h = 00:00, 03:00 + 24h = 03:00 — never
      -- anything larger), so that comparison was silently always false for
      -- the entire evening portion of any midnight-spanning shift, well
      -- before it was ever close to actually closing. EXTRACT(EPOCH ...)
      -- into plain numeric seconds sidesteps the time type's wraparound
      -- entirely, the same way isOpenWithBuffer's closingMinutes + 1440 does.
      AND EXTRACT(EPOCH FROM ${localNow}::time) + 60 * ${bufferMinutes} < EXTRACT(EPOCH FROM vh.closes_at) + 86400
    )
    OR (
      vh.day_of_week = EXTRACT(DOW FROM (${localNow} - interval '1 day'))::int
      AND vh.closes_at <= vh.opens_at
      AND ${localNow}::time + interval '1 minute' * ${bufferMinutes} < vh.closes_at
    )
  )`;
}

// F1.6: SQL predicate for one intent filter, matched against
// venue_attributes_resolved (the confidence-computing view — see
// migrations/0001_attribute_confidence.sql). Returns null for open_now,
// whose attributeKey is null because it's already enforced unconditionally
// by the open_now CTE above, not by an attribute lookup.
//
// `var.value ILIKE 'yes%'` rather than `= 'yes'`: seed.ts and real curator
// data both go wider than the registry's declared yes|no (e.g.
// "ground floor only", "yes - rooftop"), so an exact match would silently
// exclude venues that do satisfy the filter.
//
// `confidence <> 'unconfirmed'` on every branch: a filter must never match
// on an attribute we can't currently attest, per CLAUDE.md's "degrade
// honestly" invariant applied to filtering, not just display.
function filterMatchSqlCondition(filterId: IntentFilterId, venueIdRef = drizzleSql`cv.id`) {
  const def = INTENT_FILTER_REGISTRY_BY_ID.get(filterId);
  if (!def || def.attributeKey === null) return null;

  // cover_charge has no structured boolean field — it's curator free text
  // ("$15 after 9pm", "free") — so "no cover" is a known, documented
  // string-token match rather than a real enum comparison.
  const valuePredicate =
    filterId === "no_cover"
      ? drizzleSql`lower(btrim(var.value)) IN (${drizzleSql.join(
          NO_COVER_VALUE_TOKENS.map((token) => drizzleSql`${token}`),
          drizzleSql`, `,
        )})`
      : drizzleSql`var.value ILIKE 'yes%'`;

  return drizzleSql`EXISTS (
    SELECT 1 FROM venue_attributes_resolved var
    WHERE var.venue_id = ${venueIdRef}
      AND var.attribute_key = ${def.attributeKey}
      AND var.confidence <> 'unconfirmed'
      AND ${valuePredicate}
  )`;
}

function combineFilterConditions(filters: readonly IntentFilterId[]) {
  const conditions = filters
    .map((id) => filterMatchSqlCondition(id))
    .filter((condition): condition is NonNullable<typeof condition> => condition !== null);
  if (conditions.length === 0) return drizzleSql`true`;
  return drizzleSql.join(conditions, drizzleSql` AND `);
}

// Suburb scale for the opt-in "this suburb only" restriction — deliberately
// NOT implemented as a match against venues.precinct. That column is
// free-text, set per-venue at import/curation time (real suburb names like
// "Haymarket", "Ultimo", "Sydney"), and doesn't reliably equal the curated
// PRECINCT_REGISTRY label a visitor picks (e.g. picking "Surry Hills" has no
// venues literally labelled "Surry Hills" — they're "Haymarket"/"Ultimo"
// nearby). A string match against that column silently returns zero rows for
// most precincts. Capping the radius instead is always geographically
// meaningful, regardless of what a venue's own precinct label happens to be.
export const PRECINCT_ONLY_RADIUS_METERS = 1500;

// Candidate-venues CTE body, shared by every query in this file that needs
// "venues within radiusMeters of (lat, lng)" — the ranking query,
// countVenuesPerFilter, and getClosingSoonVenues — so they never drift on
// what the candidate pool means. Unrestricted by default — venues city-wide
// within radiusMeters are all candidates, ranked by distance (see
// FEED_SCORING_WEIGHTS). `precinctOnly`, when true, is a genuine visitor
// opt-in ("this suburb only") that clamps the effective radius to
// PRECINCT_ONLY_RADIUS_METERS — distinct from (lat, lng), which is just the
// ranking origin (geolocation or a picked precinct's hub centroid) and never
// restricts the candidate pool on its own.
function candidateVenuesCte(params: { lat: number; lng: number; radiusMeters: number; precinctOnly?: boolean }) {
  const { lat, lng, radiusMeters, precinctOnly } = params;
  const effectiveRadius = precinctOnly ? Math.min(radiusMeters, PRECINCT_ONLY_RADIUS_METERS) : radiusMeters;
  return drizzleSql`
    candidate_venues AS (
      SELECT
        v.id,
        v.name,
        v.precinct,
        v.quality_tier,
        v.source,
        v.location,
        v.photo_url,
        v.photo_ref,
        v.photo_attribution,
        v.curator_pitch,
        ST_Distance(v.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m
      FROM venues v
      WHERE ST_DWithin(v.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${effectiveRadius})
    )
  `;
}

// "Venues (from a preceding candidate_venues CTE) with an open venue_hours
// row for `now`, not closing within `bufferMinutes`" — named `cteName` so
// getClosingSoonVenues can materialise it twice, once per buffer, without
// duplicating the openNowSqlCondition wiring.
function openVenuesCte(cteName: string, now: Date, bufferMinutes: number) {
  return drizzleSql`
    ${drizzleSql.raw(cteName)} AS (
      SELECT DISTINCT cv.id
      FROM candidate_venues cv
      JOIN venue_hours vh ON vh.venue_id = cv.id
      WHERE vh.is_closed = false
        AND vh.opens_at IS NOT NULL
        AND vh.closes_at IS NOT NULL
        AND ${openNowSqlCondition(now, bufferMinutes)}
    )
  `;
}

function candidateAndOpenNowCte(params: { lat: number; lng: number; radiusMeters: number; now: Date; precinctOnly?: boolean }) {
  const { lat, lng, radiusMeters, now, precinctOnly } = params;
  return drizzleSql`${candidateVenuesCte({ lat, lng, radiusMeters, precinctOnly })}, ${openVenuesCte("open_now", now, FEED_CLOSING_BUFFER_MINUTES)}`;
}

// Renders the FEED_SCORING_WEIGHTS constant into the ORDER BY expression,
// so changing a weight above is the only edit a ranking change ever needs.
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// `includeOpenPenalty`: only relevant once `open_now` is a LEFT JOIN (i.e.
// openNowOnly:false already admitted closed/unknown-hours venues) — a fixed
// penalty far larger than any other weight combined, so a closed venue can
// never outrank an open one purely on distance/tier/freshness, while still
// ranking normally *among* the other closed venues.
function scoreSqlExpression(includeOpenPenalty: boolean) {
  const tierCases = Object.entries(FEED_SCORING_WEIGHTS.qualityTier)
    .map(([tier, weight]) => `WHEN ${sqlStringLiteral(tier)} THEN ${weight}`)
    .join(" ");
  const sourceCases = Object.entries(FEED_SCORING_WEIGHTS.source)
    .map(([source, weight]) => `WHEN ${sqlStringLiteral(source)} THEN ${weight}`)
    .join(" ");
  const openPenalty = includeOpenPenalty ? "+ CASE WHEN is_open_now THEN 0 ELSE -1000 END" : "";

  return drizzleSql.raw(`(
    ${FEED_SCORING_WEIGHTS.distance} * LEAST(normalised_distance, 1)
    + COALESCE(CASE quality_tier ${tierCases} ELSE 0 END, 0)
    + ${FEED_SCORING_WEIGHTS.freshness} * freshness_score
    + COALESCE(CASE source ${sourceCases} ELSE 0 END, 0)
    ${openPenalty}
  )`);
}

export interface GetFeedVenuesParams {
  /** Display label only — not used to filter candidates. Kept as a
   *  cache-key namespace input for feed-cache.ts. See `precinctOnly` for
   *  the actual opt-in "this suburb only" restriction. */
  precinct?: string;
  lat: number;
  lng: number;
  /** Search radius in metres. Defaults to 2000 (a comfortable walking radius). */
  radiusMeters?: number;
  /** Opt-in "this suburb only" restriction — clamps the effective radius to
   *  PRECINCT_ONLY_RADIUS_METERS rather than matching venues.precinct (see
   *  that constant's doc comment for why a text match doesn't work). False/
   *  omitted (the default) means city-wide: every venue within radiusMeters
   *  of (lat, lng) is a candidate regardless of precinct. Distinct from
   *  `precinct`/`lat`/`lng`, which only set the ranking origin — picking a
   *  precinct as a starting point should never silently exclude venues
   *  elsewhere in the city unless the visitor explicitly asked for that. */
  precinctOnly?: boolean;
  limit?: number;
  now?: Date;
  /** F1.6 intent filters, AND-composed. open_now is never included here —
   *  see openNowOnly below, a separate, explicit F1.8 toggle rather than an
   *  attribute-style filter. */
  filters?: IntentFilterId[];
  /** F1.8: defaults true (existing F1.1-F1.4 behaviour, unchanged) — only
   *  venues open right now and not closing within FEED_CLOSING_BUFFER_MINUTES
   *  are candidates at all. false admits every venue in radius regardless of
   *  hours, each carrying its own FeedVenueAvailability so the UI can label
   *  closed/unconfirmed ones honestly instead of hiding that fact. Unlike
   *  the F1.6 filters, this is a visitor-initiated override, not something
   *  the F1.7 relaxation ladder ever flips on its own — intent-filters.ts's
   *  `droppable: false` on open_now still governs the ladder specifically. */
  openNowOnly?: boolean;
}

interface FeedCandidateRow extends Record<string, unknown> {
  id: string;
  name: string;
  precinct: string;
  source: VenueSource;
  lat: number;
  lng: number;
  photoUrl: string | null;
  photoRef: string | null;
  photoAttribution: string | null;
  curatorPitch: string | null;
}

// Shared query body for the feed ranking pipeline (F1.1-F1.4): venues within
// `radiusMeters` of (lat, lng), optionally restricted to `precinctOnly`,
// filtered to those open right now and not closing within
// FEED_CLOSING_BUFFER_MINUTES, ranked by
// FEED_SCORING_WEIGHTS, capped at `limit`. Returns raw coordinates alongside
// each row — getFeedVenues (below) discards them to keep its public return
// type provenance-only; getFeedVenuesWithLocation (feed-cache.ts's source of
// truth) keeps them, since the cache's post-read exact-distance sort needs
// real venue coordinates that the public VenueCardData shape doesn't carry.
async function runFeedRankingQuery(params: GetFeedVenuesParams): Promise<FeedCandidateRow[]> {
  const { lat, lng, radiusMeters = 2000, limit, now = new Date(), filters = [], openNowOnly = true, precinctOnly } = params;

  // No `limit` means no cap — every candidate within radiusMeters is
  // returned, ranked. Postgres omits LIMIT entirely rather than being
  // handed a sentinel "unlimited" number.
  const limitClause = limit !== undefined ? drizzleSql`LIMIT ${limit}` : drizzleSql``;

  // openNowOnly:true keeps the exact original INNER JOIN — every candidate
  // is guaranteed open, no penalty term needed. openNowOnly:false LEFT JOINs
  // instead so closed/unconfirmed-hours venues are admitted too, carrying
  // an is_open_now flag the score expression uses to always rank them below
  // open ones (see scoreSqlExpression).
  const openNowJoin = openNowOnly
    ? drizzleSql`JOIN open_now ON open_now.id = cv.id`
    : drizzleSql`LEFT JOIN open_now ON open_now.id = cv.id`;
  const isOpenNowColumn = openNowOnly ? drizzleSql`true AS is_open_now` : drizzleSql`(open_now.id IS NOT NULL) AS is_open_now`;

  const result = await db.execute<FeedCandidateRow>(drizzleSql`
    WITH ${candidateAndOpenNowCte({ lat, lng, radiusMeters, now, precinctOnly })},
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
        cv.source,
        cv.location,
        cv.photo_url,
        cv.photo_ref,
        cv.photo_attribution,
        cv.curator_pitch,
        ${isOpenNowColumn},
        LEAST(cv.distance_m / ${DISTANCE_NORMALISER_METERS}::float, 1) AS normalised_distance,
        COALESCE(bf.freshness_score, 0) AS freshness_score
      FROM candidate_venues cv
      ${openNowJoin}
      LEFT JOIN badge_freshness bf ON bf.venue_id = cv.id
      WHERE ${combineFilterConditions(filters)}
    )
    SELECT
      id, name, precinct, source,
      photo_url AS "photoUrl", photo_ref AS "photoRef", photo_attribution AS "photoAttribution",
      curator_pitch AS "curatorPitch",
      ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM scored
    ORDER BY ${scoreSqlExpression(!openNowOnly)} DESC
    ${limitClause}
  `);

  return result.rows;
}

// FeedVenue's one extra field over VenueCardData. Always populated (even
// when openNowOnly:true, where it's trivially "open") so every feed read
// path returns one consistent shape rather than a type that varies with a
// runtime boolean.
export interface FeedVenue extends VenueCardData {
  availability: FeedVenueAvailability;
}

// Batched venue_hours read for tonightAvailability, one query regardless of
// candidate count. Only ever called with openNowOnly:false's candidate rows
// — openNowOnly:true skips this entirely (every row is already known-open,
// see buildAvailabilityMap below), so the default feed path pays no extra
// query cost for this feature.
async function fetchHoursByVenueId(venueIds: string[]): Promise<Map<string, VenueHoursInput[]>> {
  const byVenue = new Map<string, VenueHoursInput[]>();
  if (venueIds.length === 0) return byVenue;

  const rows = await db
    .select({
      venueId: venueHours.venueId,
      dayOfWeek: venueHours.dayOfWeek,
      isClosed: venueHours.isClosed,
      opensAt: venueHours.opensAt,
      closesAt: venueHours.closesAt,
    })
    .from(venueHours)
    .where(inArray(venueHours.venueId, venueIds));

  for (const row of rows) {
    const list = byVenue.get(row.venueId) ?? [];
    list.push({ dayOfWeek: row.dayOfWeek, isClosed: row.isClosed, opensAt: row.opensAt, closesAt: row.closesAt });
    byVenue.set(row.venueId, list);
  }
  return byVenue;
}

async function buildAvailabilityMap(rows: FeedCandidateRow[], openNowOnly: boolean, now: Date): Promise<Map<string, FeedVenueAvailability>> {
  const map = new Map<string, FeedVenueAvailability>();
  if (openNowOnly) {
    // Every row is guaranteed open by runFeedRankingQuery's INNER JOIN — no
    // need to know the exact closesAt for this synthetic case, since the
    // UI never renders availability at all when openNowOnly is true.
    for (const row of rows) map.set(row.id, { status: "open", closesAt: "", spansMidnight: false });
    return map;
  }
  const hoursByVenue = await fetchHoursByVenueId(rows.map((r) => r.id));
  for (const row of rows) map.set(row.id, tonightAvailability(hoursByVenue.get(row.id) ?? [], now));
  return map;
}

// Shared enrichment step for every query in this file that returns
// FeedVenue[]-shaped results: fetches provenance-badge attribute rows and
// tonight's availability for a candidate row set in one round trip each
// (regardless of row count), then builds each row's FeedVenue. Centralised
// here so getFeedVenues, getFeedVenuesWithLocation, and getClosingSoonVenues
// can't drift on how a FeedCandidateRow becomes a FeedVenue.
async function buildFeedVenueMap(rows: FeedCandidateRow[], openNowOnly: boolean, now: Date): Promise<Map<string, FeedVenue>> {
  const [attributeRows, availability] = await Promise.all([
    fetchAttributeViewRows(rows.map((v) => v.id)),
    buildAvailabilityMap(rows, openNowOnly, now),
  ]);

  // Group once (O(rows)) rather than having buildVenueCard filter the full
  // attribute-rows array per venue (O(venues x rows)) — this runs on every
  // feed request.
  const attributesByVenue = new Map<string, typeof attributeRows>();
  for (const row of attributeRows) {
    const list = attributesByVenue.get(row.venueId) ?? [];
    list.push(row);
    attributesByVenue.set(row.venueId, list);
  }

  const map = new Map<string, FeedVenue>();
  for (const row of rows) {
    map.set(row.id, {
      ...buildVenueCard(row, attributesByVenue.get(row.id) ?? [], now),
      availability: availability.get(row.id) ?? { status: "unknown" },
    });
  }
  return map;
}

// The public read path for a feed page. Attributes are returned exclusively
// as AttributeView badges (provenance.ts) — there is no path from this
// function's return value back to a bare venue_attributes value, and no
// coordinates leak out either (see runFeedRankingQuery above).
export async function getFeedVenues(params: GetFeedVenuesParams): Promise<FeedVenue[]> {
  const rows = await runFeedRankingQuery(params);
  if (rows.length === 0) return [];

  const openNowOnly = params.openNowOnly ?? true;
  const now = params.now ?? new Date();
  const venueMap = await buildFeedVenueMap(rows, openNowOnly, now);
  return rows.map((row) => venueMap.get(row.id)!);
}

export interface FeedVenueWithLocation {
  venue: FeedVenue;
  lat: number;
  lng: number;
}

// Same ranked candidate set as getFeedVenues, but keeps each venue's
// coordinates. Used exclusively by the feed cache (apps/web/app/api/feed/
// feed-cache.ts), which caches this coarser, geohash-cell-shared result and
// then re-sorts by exact distance from each request's true coordinates
// after reading it back — see CLAUDE.md's Redis feed cache spec.
export async function getFeedVenuesWithLocation(params: GetFeedVenuesParams): Promise<FeedVenueWithLocation[]> {
  const rows = await runFeedRankingQuery(params);
  if (rows.length === 0) return [];

  const openNowOnly = params.openNowOnly ?? true;
  const now = params.now ?? new Date();
  const venueMap = await buildFeedVenueMap(rows, openNowOnly, now);
  return rows.map((row) => ({ venue: venueMap.get(row.id)!, lat: row.lat, lng: row.lng }));
}

export interface CountVenuesPerFilterParams {
  lat: number;
  lng: number;
  radiusMeters?: number;
  now?: Date;
  filters: readonly IntentFilterId[];
  precinctOnly?: boolean;
}

// F1.7 rung 3 support: how many venues in the current candidate pool
// (precinct + radius + open-now, independent of every OTHER active filter)
// each droppable filter matches on its own. The relaxation ladder drops
// whichever active filter comes back with the highest count here — the one
// contributing least to narrowing the result set, i.e. the least selective
// one. open_now is never included: it isn't droppable (see intent-filters.ts).
export async function countVenuesPerFilter(
  params: CountVenuesPerFilterParams,
): Promise<Partial<Record<IntentFilterId, number>>> {
  const { lat, lng, radiusMeters = 2000, now = new Date(), filters, precinctOnly } = params;
  const droppable = filters.filter((id) => INTENT_FILTER_REGISTRY_BY_ID.get(id)?.droppable);
  if (droppable.length === 0) return {};

  // One aggregation query over the shared candidate pool rather than one
  // query per filter — droppable.length used to mean droppable.length
  // separate round trips against the same candidate_venues/open_now CTEs.
  const countExprs = droppable.map(
    (filterId) => drizzleSql`COUNT(*) FILTER (WHERE ${filterMatchSqlCondition(filterId) ?? drizzleSql`true`})::int AS ${drizzleSql.raw(`"${filterId}"`)}`,
  );

  const result = await db.execute<Record<string, number>>(drizzleSql`
    WITH ${candidateAndOpenNowCte({ lat, lng, radiusMeters, now, precinctOnly })}
    SELECT ${drizzleSql.join(countExprs, drizzleSql`, `)}
    FROM candidate_venues cv
    JOIN open_now ON open_now.id = cv.id
  `);

  const row = result.rows[0] ?? {};
  const counts: Partial<Record<IntentFilterId, number>> = {};
  for (const filterId of droppable) counts[filterId] = row[filterId] ?? 0;
  return counts;
}

// F1.7 rung 5 support: venues open right now but closing within
// FEED_CLOSING_BUFFER_MINUTES — the exact complement of the open_now CTE's
// exclusion. Deliberately a separate function rather than a flag on
// getFeedVenues/getFeedVenuesWithLocation: there is no way for a caller to
// accidentally fold these into the main feed result, only to ask for them
// explicitly for the labelled "closing soon" section (CLAUDE.md invariant 5
// and the PRD's 45-minute rule are never relaxed).
export async function getClosingSoonVenues(params: GetFeedVenuesParams): Promise<FeedVenue[]> {
  const { lat, lng, radiusMeters = 2000, limit, now = new Date(), precinctOnly } = params;
  const limitClause = limit !== undefined ? drizzleSql`LIMIT ${limit}` : drizzleSql``;

  const result = await db.execute<FeedCandidateRow>(drizzleSql`
    WITH ${candidateVenuesCte({ lat, lng, radiusMeters, precinctOnly })},
    ${openVenuesCte("open_no_buffer", now, 0)},
    ${openVenuesCte("open_with_buffer", now, FEED_CLOSING_BUFFER_MINUTES)},
    closing_soon AS (
      SELECT id FROM open_no_buffer
      EXCEPT
      SELECT id FROM open_with_buffer
    )
    SELECT
      cv.id, cv.name, cv.precinct, cv.source,
      cv.photo_url AS "photoUrl", cv.photo_ref AS "photoRef", cv.photo_attribution AS "photoAttribution",
      cv.curator_pitch AS "curatorPitch",
      ST_Y(cv.location::geometry) AS lat, ST_X(cv.location::geometry) AS lng
    FROM candidate_venues cv
    JOIN closing_soon cs ON cs.id = cv.id
    ORDER BY cv.distance_m ASC
    ${limitClause}
  `);

  if (result.rows.length === 0) return [];

  // openNowOnly:false, since this section is specifically labelled "closing
  // soon" and needs the real closesAt (not the synthetic "" used elsewhere).
  const venueMap = await buildFeedVenueMap(result.rows, false, now);
  return result.rows.map((row) => venueMap.get(row.id)!);
}
