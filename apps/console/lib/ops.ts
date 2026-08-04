// Read-only aggregation over verification_events for the /ops dashboard.
// Unlike lib/queue-store.ts and friends, this has no AUTH_TEST_MODE branch:
// it's not exercised by Playwright (queue.spec.ts asserts the queue's own
// wall-clock/tap budget, not the dashboard), so there's no in-memory
// counterpart to keep in sync — it always queries Drizzle/Neon directly.
export interface OpsOverall {
  totalEvents: number;
  medianDurationMs: number | null;
  p90DurationMs: number | null;
}

export interface OpsPerAttribute {
  attributeKey: string;
  count: number;
  medianDurationMs: number | null;
  p90DurationMs: number | null;
}

export interface OpsPerCurator {
  curatorName: string;
  confirmCount: number;
  correctCount: number;
  total: number;
}

export interface OpsSummary {
  sinceDays: number;
  overall: OpsOverall;
  perAttribute: OpsPerAttribute[];
  perCurator: OpsPerCurator[];
}

interface OverallRow {
  total_events: number;
  median_ms: string | null;
  p90_ms: string | null;
}
interface PerAttributeRow {
  attribute_key: string;
  count: number;
  median_ms: string | null;
  p90_ms: string | null;
}
interface PerCuratorRow {
  curator_name: string;
  confirm_count: number;
  correct_count: number;
  total: number;
}

function toMs(value: string | null): number | null {
  return value === null ? null : Math.round(Number(value));
}

export async function getOpsSummary(sinceDays = 7): Promise<OpsSummary> {
  const { db } = await import("@pulse/db");
  const { sql } = await import("drizzle-orm");
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const overallResult = await db.execute(sql`
    select
      count(*)::int as total_events,
      percentile_cont(0.5) within group (order by duration_ms) as median_ms,
      percentile_cont(0.9) within group (order by duration_ms) as p90_ms
    from verification_events
    where verified_at >= ${since} and duration_ms is not null
  `);
  const overallRow = overallResult.rows[0] as unknown as OverallRow | undefined;

  const perAttributeResult = await db.execute(sql`
    select
      va.attribute_key as attribute_key,
      count(ve.*)::int as count,
      percentile_cont(0.5) within group (order by ve.duration_ms) as median_ms,
      percentile_cont(0.9) within group (order by ve.duration_ms) as p90_ms
    from verification_events ve
    join venue_attributes va on va.id = ve.venue_attribute_id
    where ve.verified_at >= ${since} and ve.duration_ms is not null
    group by va.attribute_key
    order by count desc
  `);

  const perCuratorResult = await db.execute(sql`
    select
      c.name as curator_name,
      count(*) filter (where ve.action = 'confirm')::int as confirm_count,
      count(*) filter (where ve.action = 'correct')::int as correct_count,
      count(*)::int as total
    from verification_events ve
    join curators c on c.id = ve.curator_id
    where ve.verified_at >= ${since}
    group by c.name
    order by total desc
  `);

  return {
    sinceDays,
    overall: {
      totalEvents: overallRow?.total_events ?? 0,
      medianDurationMs: toMs(overallRow?.median_ms ?? null),
      p90DurationMs: toMs(overallRow?.p90_ms ?? null),
    },
    perAttribute: (perAttributeResult.rows as unknown as PerAttributeRow[]).map((row) => ({
      attributeKey: row.attribute_key,
      count: row.count,
      medianDurationMs: toMs(row.median_ms),
      p90DurationMs: toMs(row.p90_ms),
    })),
    perCurator: (perCuratorResult.rows as unknown as PerCuratorRow[]).map((row) => ({
      curatorName: row.curator_name,
      confirmCount: row.confirm_count,
      correctCount: row.correct_count,
      total: row.total,
    })),
  };
}
