// F0.5 + §9: the ops dashboard's coverage/freshness/flag metrics — "a page
// over SQL views, deliberately unfancy". Each metric is a pure function
// over row fixtures (tested in dashboard.test.ts against a known dataset)
// plus a thin DB query that feeds it, mirroring packages/db/src/queue.ts's
// buildQueueItems split.
import { ATTRIBUTE_REGISTRY, attributeConfidence } from "@pulse/db";

const REQUIRED_ATTRIBUTE_KEYS = ATTRIBUTE_REGISTRY.map((entry) => entry.key);

// --- Coverage % by precinct ------------------------------------------------

export interface VenueAttributeStateRow {
  venueId: string;
  precinct: string;
  attributeKey: string;
  lastVerifiedAt: Date;
  flagCount: number;
}

export interface PrecinctCoverage {
  precinct: string;
  totalVenues: number;
  fullyFreshVenues: number;
  coveragePct: number;
}

// A venue "has coverage" only if every required attribute (the full
// registry) currently resolves to 'fresh' — 'ageing' doesn't count, since
// coverage is meant to answer "how much of the map can we vouch for right
// now", not "how much haven't we lost yet".
export function computeCoverage(rows: VenueAttributeStateRow[], now: Date): PrecinctCoverage[] {
  const venues = new Map<string, { precinct: string; freshKeys: Set<string> }>();
  for (const row of rows) {
    let venue = venues.get(row.venueId);
    if (!venue) {
      venue = { precinct: row.precinct, freshKeys: new Set() };
      venues.set(row.venueId, venue);
    }
    const confidence = attributeConfidence({
      attributeKey: row.attributeKey,
      lastVerifiedAt: row.lastVerifiedAt,
      flagCount: row.flagCount,
      now,
    });
    if (confidence === "fresh") venue.freshKeys.add(row.attributeKey);
  }

  const byPrecinct = new Map<string, { total: number; fresh: number }>();
  for (const venue of venues.values()) {
    const stat = byPrecinct.get(venue.precinct) ?? { total: 0, fresh: 0 };
    stat.total += 1;
    if (REQUIRED_ATTRIBUTE_KEYS.every((key) => venue.freshKeys.has(key))) stat.fresh += 1;
    byPrecinct.set(venue.precinct, stat);
  }

  return [...byPrecinct.entries()]
    .map(([precinct, stat]) => ({
      precinct,
      totalVenues: stat.total,
      fullyFreshVenues: stat.fresh,
      coveragePct: stat.total === 0 ? 0 : Math.round((stat.fresh / stat.total) * 1000) / 10,
    }))
    .sort((a, b) => a.precinct.localeCompare(b.precinct));
}

// --- Mean badge age --------------------------------------------------------

export interface BadgeAgeRow {
  precinct: string;
  attributeKey: string;
  lastVerifiedAt: Date;
}

export interface MeanAgeStat {
  key: string;
  meanAgeHours: number;
  count: number;
}

export function computeMeanBadgeAge(rows: BadgeAgeRow[], now: Date): { byPrecinct: MeanAgeStat[]; byAttribute: MeanAgeStat[] } {
  function groupBy(keyOf: (row: BadgeAgeRow) => string): MeanAgeStat[] {
    const acc = new Map<string, { sumHours: number; count: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const ageHours = (now.getTime() - row.lastVerifiedAt.getTime()) / (1000 * 60 * 60);
      const entry = acc.get(key) ?? { sumHours: 0, count: 0 };
      entry.sumHours += ageHours;
      entry.count += 1;
      acc.set(key, entry);
    }
    return [...acc.entries()]
      .map(([key, { sumHours, count }]) => ({ key, meanAgeHours: Math.round((sumHours / count) * 10) / 10, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  return {
    byPrecinct: groupBy((row) => row.precinct),
    byAttribute: groupBy((row) => row.attributeKey),
  };
}

// --- Correction-flag rate per venue-week, worst 10 -------------------------

export interface VenueFlagWeekRow {
  venueId: string;
  venueName: string;
  flagCount: number;
  attributeCount: number;
}

export interface VenueFlagRate extends VenueFlagWeekRow {
  ratePerAttribute: number;
}

// Rate is flags-this-week divided by the venue's total curated attribute
// count, not a raw flag count — otherwise a venue with more attributes
// would always look worse just for being more thoroughly curated.
export function computeWorstFlagRate(rows: VenueFlagWeekRow[], limit = 10): VenueFlagRate[] {
  return rows
    .map((row) => ({ ...row, ratePerAttribute: row.attributeCount === 0 ? 0 : Math.round((row.flagCount / row.attributeCount) * 1000) / 1000 }))
    .sort((a, b) => b.ratePerAttribute - a.ratePerAttribute || b.flagCount - a.flagCount)
    .slice(0, limit);
}

// --- Open flags, oldest first -----------------------------------------------

export interface OpenFlagRow {
  id: string;
  venueId: string;
  venueName: string;
  attributeKey: string;
  flaggedAt: Date;
}

export interface OpenFlagWithAge extends OpenFlagRow {
  ageHours: number;
}

// "Open" isn't a stored status — a flag counts as open as long as it's
// newer than the attribute's last_verified_at (i.e. no curator has
// re-verified since it was raised). The DB query that feeds this filters
// on exactly that join condition.
export function computeOpenFlags(rows: OpenFlagRow[], now: Date): OpenFlagWithAge[] {
  return rows
    .map((row) => ({ ...row, ageHours: Math.round(((now.getTime() - row.flaggedAt.getTime()) / (1000 * 60 * 60)) * 10) / 10 }))
    .sort((a, b) => a.flaggedAt.getTime() - b.flaggedAt.getTime());
}

// --- DB orchestration --------------------------------------------------------

export interface DashboardSummary {
  coverage: PrecinctCoverage[];
  meanBadgeAge: { byPrecinct: MeanAgeStat[]; byAttribute: MeanAgeStat[] };
  worstFlagRate: VenueFlagRate[];
  openFlags: OpenFlagWithAge[];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { db } = await import("@pulse/db");
  const { sql } = await import("drizzle-orm");
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
  weekStart.setUTCHours(0, 0, 0, 0);

  const stateResult = await db.execute(sql`
    select
      va.venue_id as venue_id,
      v.precinct as precinct,
      va.attribute_key as attribute_key,
      va.last_verified_at as last_verified_at,
      (
        select count(*)::int from correction_flags cf
        where cf.venue_attribute_id = va.id and cf.flagged_at >= now() - interval '24 hours'
      ) as flag_count
    from venue_attributes va
    join venues v on v.id = va.venue_id
  `);
  const stateRows = (
    stateResult.rows as unknown as {
      venue_id: string;
      precinct: string;
      attribute_key: string;
      last_verified_at: string;
      flag_count: number;
    }[]
  ).map((row) => ({
    venueId: row.venue_id,
    precinct: row.precinct,
    attributeKey: row.attribute_key,
    lastVerifiedAt: new Date(row.last_verified_at),
    flagCount: row.flag_count,
  }));

  const flagWeekResult = await db.execute(sql`
    select
      v.id as venue_id,
      v.name as venue_name,
      count(cf.*)::int as flag_count,
      (select count(*)::int from venue_attributes va2 where va2.venue_id = v.id) as attribute_count
    from venues v
    left join venue_attributes va on va.venue_id = v.id
    left join correction_flags cf on cf.venue_attribute_id = va.id and cf.flagged_at >= ${weekStart}
    group by v.id, v.name
  `);
  const flagWeekRows = (
    flagWeekResult.rows as unknown as { venue_id: string; venue_name: string; flag_count: number; attribute_count: number }[]
  ).map((row) => ({ venueId: row.venue_id, venueName: row.venue_name, flagCount: row.flag_count, attributeCount: row.attribute_count }));

  const openFlagsResult = await db.execute(sql`
    select
      cf.id as id,
      v.id as venue_id,
      v.name as venue_name,
      va.attribute_key as attribute_key,
      cf.flagged_at as flagged_at
    from correction_flags cf
    join venue_attributes va on va.id = cf.venue_attribute_id
    join venues v on v.id = va.venue_id
    where cf.flagged_at > va.last_verified_at
  `);
  const openFlagRows = (
    openFlagsResult.rows as unknown as { id: string; venue_id: string; venue_name: string; attribute_key: string; flagged_at: string }[]
  ).map((row) => ({
    id: row.id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    attributeKey: row.attribute_key,
    flaggedAt: new Date(row.flagged_at),
  }));

  return {
    coverage: computeCoverage(stateRows, now),
    meanBadgeAge: computeMeanBadgeAge(stateRows, now),
    worstFlagRate: computeWorstFlagRate(flagWeekRows, 10),
    openFlags: computeOpenFlags(openFlagRows, now),
  };
}
