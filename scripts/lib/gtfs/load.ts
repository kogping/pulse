// DB side of the weekly GTFS import: staging tables + the one transactional
// swap into transit_hubs/scheduled_departures, plus import_runs bookkeeping.
//
// Uses `pg` directly (not packages/db/src/client.ts, which is neon-http and
// has no interactive transactions — see docs/spikes/tfnsw.md and the plan
// for this feature). This is a root-only devDependency; apps/web and
// apps/console are untouched, so there's no cold-start impact.
import { Client } from "pg";
import type { ImportRunSummary, StagedDeparture, TransitMode } from "./parse";

export interface StagedHub {
  gtfsStopId: string;
  name: string;
  mode: TransitMode;
  lat: number;
  lng: number;
}

// Inlined as a SQL CASE rather than a function so it can be used both to
// rank rows staged within a single run (two bundles touching the same
// interchange) and to compare an incoming row against the hub's current
// mode already in the database (so a bus-only re-run can never downgrade a
// train hub that a prior run already established).
const MODE_PRECEDENCE_SQL = `CASE %MODE% WHEN 'metro' THEN 5 WHEN 'train' THEN 4 WHEN 'light_rail' THEN 3 WHEN 'ferry' THEN 2 WHEN 'bus' THEN 1 ELSE 0 END`;

function modePrecedence(column: string): string {
  return MODE_PRECEDENCE_SQL.replace("%MODE%", column);
}

const BATCH_SIZE = 1000;

async function insertBatched(
  client: Client,
  table: string,
  columns: readonly string[],
  rows: readonly unknown[][],
): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((row, rowIdx) => {
      const rowPlaceholders = row.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`);
      values.push(...row);
      return `(${rowPlaceholders.join(", ")})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`, values);
  }
}

export async function connect(databaseUrl: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

export async function createStagingTables(client: Client): Promise<void> {
  // TEMP tables live for the session, so a crash or disconnect mid-import
  // leaves nothing to clean up — the next run starts from a clean session.
  await client.query(`
    CREATE TEMP TABLE gtfs_hub_staging (
      gtfs_stop_id text NOT NULL,
      name text NOT NULL,
      mode text NOT NULL,
      lat double precision NOT NULL,
      lng double precision NOT NULL
    );
  `);
  await client.query(`
    CREATE TEMP TABLE gtfs_departure_staging (
      gtfs_stop_id text NOT NULL,
      route text NOT NULL,
      headsign text,
      direction smallint,
      day_of_week integer NOT NULL,
      scheduled_time time NOT NULL,
      service_days smallint NOT NULL,
      gtfs_trip_id text NOT NULL
    );
  `);
}

export async function stageHubs(client: Client, hubs: readonly StagedHub[]): Promise<void> {
  await insertBatched(
    client,
    "gtfs_hub_staging",
    ["gtfs_stop_id", "name", "mode", "lat", "lng"],
    hubs.map((h) => [h.gtfsStopId, h.name, h.mode, h.lat, h.lng]),
  );
}

export async function stageDepartures(client: Client, departures: readonly StagedDeparture[]): Promise<void> {
  await insertBatched(
    client,
    "gtfs_departure_staging",
    ["gtfs_stop_id", "route", "headsign", "direction", "day_of_week", "scheduled_time", "service_days", "gtfs_trip_id"],
    departures.map((d) => [d.hubStopId, d.route, d.headsign, d.direction, d.dayOfWeek, d.scheduledTime, d.serviceDays, d.gtfsTripId]),
  );
}

export interface SwapResult {
  hubCount: number;
  departureCount: number;
}

// The one transaction the whole import earns its "idempotent, transactional"
// description from: readers see last week's rows right up until COMMIT, so
// any failure before this point — a bad bundle, a network drop, a crashed
// runner — leaves last week's timetable serving untouched.
export async function swapStagedData(client: Client): Promise<SwapResult> {
  await client.query("BEGIN");
  try {
    const hubResult = await client.query(`
      WITH ranked AS (
        SELECT gtfs_stop_id, name, mode, lat, lng,
               row_number() OVER (PARTITION BY gtfs_stop_id ORDER BY ${modePrecedence("mode")} DESC) AS rn
        FROM gtfs_hub_staging
      )
      INSERT INTO transit_hubs (name, mode, location, gtfs_stop_id)
      SELECT name, mode, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, gtfs_stop_id
      FROM ranked
      WHERE rn = 1
      ON CONFLICT (gtfs_stop_id) DO UPDATE SET
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        mode = CASE
          WHEN ${modePrecedence("EXCLUDED.mode")} >= ${modePrecedence("transit_hubs.mode")}
          THEN EXCLUDED.mode ELSE transit_hubs.mode
        END
    `);

    // Scoped to gtfs_trip_id so hand-seeded or curator-entered departures
    // (which have no gtfs_trip_id) are never touched by the weekly import.
    await client.query(`DELETE FROM scheduled_departures WHERE gtfs_trip_id IS NOT NULL`);

    const departureResult = await client.query(`
      INSERT INTO scheduled_departures
        (transit_hub_id, route, headsign, day_of_week, scheduled_time, direction, service_days, gtfs_trip_id)
      SELECT DISTINCT ON (h.id, s.route, s.direction, s.day_of_week, s.scheduled_time)
        h.id, s.route, s.headsign, s.day_of_week, s.scheduled_time, s.direction, s.service_days, s.gtfs_trip_id
      FROM gtfs_departure_staging s
      JOIN transit_hubs h ON h.gtfs_stop_id = s.gtfs_stop_id
      ORDER BY h.id, s.route, s.direction, s.day_of_week, s.scheduled_time, s.gtfs_trip_id
    `);

    await client.query("COMMIT");
    return { hubCount: hubResult.rowCount ?? 0, departureCount: departureResult.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// --- import_runs bookkeeping ------------------------------------------

export async function getLastSuccessfulEtag(client: Client, source: string): Promise<string | null> {
  const result = await client.query<{ source_etag: string | null }>(
    `SELECT source_etag FROM import_runs
     WHERE source = $1 AND status IN ('succeeded', 'skipped')
     ORDER BY started_at DESC LIMIT 1`,
    [source],
  );
  return result.rows[0]?.source_etag ?? null;
}

export async function startImportRun(client: Client, source: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO import_runs (source, status) VALUES ($1, 'running') RETURNING id`,
    [source],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`failed to start import run for ${source}`);
  return id;
}

export interface FinishImportRunInput {
  status: "succeeded" | "skipped" | "failed";
  rows?: number;
  sourceEtag?: string | null;
  error?: string;
}

export async function finishImportRun(client: Client, runId: string, input: FinishImportRunInput): Promise<void> {
  await client.query(
    `UPDATE import_runs SET finished_at = now(), status = $2, rows = $3, source_etag = $4, error = $5 WHERE id = $1`,
    [runId, input.status, input.rows ?? null, input.sourceEtag ?? null, input.error ?? null],
  );
}

export async function getLatestRunsBySource(
  client: Client,
  sources: readonly string[],
): Promise<Map<string, ImportRunSummary>> {
  const result = await client.query<{ source: string; status: ImportRunSummary["status"]; finished_at: Date | null }>(
    `SELECT DISTINCT ON (source) source, status, finished_at
     FROM import_runs
     WHERE source = ANY($1)
     ORDER BY source, started_at DESC`,
    [sources],
  );
  const map = new Map<string, ImportRunSummary>();
  for (const row of result.rows) {
    map.set(row.source, { source: row.source, status: row.status, finishedAt: row.finished_at });
  }
  return map;
}
