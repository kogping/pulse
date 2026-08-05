// F3.3 — weekly static GTFS timetable import.
//
// The fallback shown whenever live TfNSW data is missing, stale, or errored
// (invariant: degrade honestly, "scheduled, not live" — never a countdown
// that might be wrong) must be current independently of the live feed
// itself. This script is that independent path: it downloads TfNSW's
// per-mode static GTFS bundles, streams-unzips them, parses stops/routes/
// trips/stop_times/calendar, and bulk-upserts into transit_hubs and
// scheduled_departures.
//
// Idempotent and transactional: every mode is parsed into staging tables
// first, then swapped into the real tables in one transaction (see
// scripts/lib/gtfs/load.ts#swapStagedData) — a failed or partial import
// leaves last week's data intact and serving.
//
// Data is TfNSW Open Data, licensed CC BY 4.0 (docs/spikes/tfnsw.md §3);
// the attribution string lives in apps/web's TFNSW_ATTRIBUTION constant.
// Known limitation: calendar_dates.txt (service exceptions) is not
// consumed, so public holidays show the ordinary weekday timetable — see
// docs/spikes/tfnsw.md.
//
// Usage:
//   TFNSW_API_KEY=... DATABASE_URL=... pnpm gtfs:import
//   TFNSW_API_KEY=... pnpm gtfs:import --modes=sydneytrains,buses --dry-run
//   TFNSW_API_KEY=... DATABASE_URL=... pnpm gtfs:import --force
//   DATABASE_URL=... pnpm gtfs:import --check-staleness
//
// Invoked by .github/workflows/gtfs-import.yml — NOT on Vercel (invariant:
// migrations/data loads run from GitHub Actions, never a Vercel build step).
import { execFileSync } from "node:child_process";
import { appendFileSync, createReadStream, createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "pg";
import { PRECINCT_REGISTRY } from "@pulse/db";
import {
  buildDepartureRows,
  checkStaleness,
  computeBundleMode,
  isServiceActiveSoon,
  parseCalendarRow,
  parseCsvHeader,
  parseGtfsTable,
  parseStopRow,
  parseTripRow,
  rowFromLine,
  routeTypeToMode,
  selectHubStops,
  type ServiceCalendar,
  type StagedDeparture,
  type TransitMode,
  type TripInfo,
} from "./lib/gtfs/parse";
import {
  connect,
  createStagingTables,
  finishImportRun,
  getLastSuccessfulEtag,
  getLatestRunsBySource,
  stageDepartures,
  stageHubs,
  startImportRun,
  swapStagedData,
  type StagedHub,
} from "./lib/gtfs/load";
import { captureStalenessAlarm, flushSentry, initSentry } from "./lib/sentry";

const BASE_URL = "https://api.transport.nsw.gov.au";
const STALENESS_MAX_AGE_DAYS = 10;

// The six precinct-relevant modes per docs/spikes/tfnsw.md §5 — the modes
// that cover every heavy-transit hub in the launch precincts. nswtrains is
// excluded (no launch precinct hub is served by it).
const MODES = ["sydneytrains", "buses", "metro", "lightrail/innerwest", "lightrail/cbdandsoutheast", "ferries/sydneyferries"] as const;

function apiKey(): string {
  const key = process.env.TFNSW_API_KEY;
  if (!key) throw new Error("TFNSW_API_KEY is required (see .env.local / docs/spikes/tfnsw.md).");
  return key;
}

function parseArgs(argv: string[]) {
  const modesArg = argv.find((a) => a.startsWith("--modes="));
  const modes = modesArg ? modesArg.slice("--modes=".length).split(",") : [...MODES];
  for (const m of modes) {
    if (!(MODES as readonly string[]).includes(m)) {
      throw new Error(`Unknown mode "${m}". Expected one of: ${MODES.join(", ")}`);
    }
  }
  return {
    modes,
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    checkStaleness: argv.includes("--check-staleness"),
  };
}

// ---- download ----------------------------------------------------------

interface DownloadResult {
  notModified: true;
}
interface DownloadedBundle {
  notModified: false;
  workDir: string;
  etag: string | null;
}

async function downloadBundle(mode: string, etagToCheck: string | null): Promise<DownloadResult | DownloadedBundle> {
  const url = `${BASE_URL}/v1/gtfs/schedule/${mode}`;
  const headers: Record<string, string> = { Authorization: `apikey ${apiKey()}` };
  if (etagToCheck) headers["If-None-Match"] = etagToCheck;

  const res = await fetch(url, { headers });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`GTFS static download failed for "${mode}": HTTP ${res.status}`);
  if (!res.body) throw new Error(`GTFS static download for "${mode}" returned no body`);

  const workDir = mkdtempSync(path.join(tmpdir(), `gtfs-import-${mode.replace(/\//g, "_")}-`));
  const zipPath = path.join(workDir, "bundle.zip");

  await finished(Readable.fromWeb(res.body).pipe(createWriteStream(zipPath)));

  // Extract only the files the importer needs — buses' full bundle is
  // ~505MB uncompressed (docs/spikes/tfnsw.md §4); shapes.txt/agency.txt
  // etc. would be pure waste.
  execFileSync(
    "unzip",
    ["-q", "-o", zipPath, "stops.txt", "routes.txt", "trips.txt", "calendar.txt", "stop_times.txt", "-d", workDir],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  return { notModified: false, workDir, etag: res.headers.get("etag") };
}

// ---- parse one bundle ----------------------------------------------------

interface ParsedBundle {
  hubs: StagedHub[];
  departures: StagedDeparture[];
}

async function parseBundle(workDir: string, now: Date): Promise<ParsedBundle> {
  const stopRows = parseGtfsTable(readFileSync(path.join(workDir, "stops.txt"), "utf8")).map(parseStopRow);
  const centroids = PRECINCT_REGISTRY.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng }));
  const { hubs, stopIdToHub } = selectHubStops(stopRows, centroids);

  const routeRows = parseGtfsTable(readFileSync(path.join(workDir, "routes.txt"), "utf8"));
  const routes = new Map<string, { routeShortName: string }>();
  const routeModes: (TransitMode | null)[] = [];
  for (const raw of routeRows) {
    const routeId = raw.route_id ?? "";
    routes.set(routeId, { routeShortName: raw.route_short_name ?? "" });
    routeModes.push(routeTypeToMode(raw.route_type ?? ""));
  }
  const bundleMode = computeBundleMode(routeModes);
  if (!bundleMode) throw new Error("could not determine a transit mode for this bundle's routes");

  const calendarRows = parseGtfsTable(readFileSync(path.join(workDir, "calendar.txt"), "utf8")).map(parseCalendarRow);
  const activeCalendars = new Map<string, ServiceCalendar>();
  for (const calendar of calendarRows) {
    if (isServiceActiveSoon(calendar, now)) activeCalendars.set(calendar.serviceId, calendar);
  }

  const tripRows = parseGtfsTable(readFileSync(path.join(workDir, "trips.txt"), "utf8"));
  const trips = new Map<string, TripInfo>();
  for (const raw of tripRows) {
    const { tripId, info } = parseTripRow(raw);
    trips.set(tripId, info);
  }

  // stop_times.txt is the one file streamed line-by-line rather than
  // loaded whole — buses' worst case is 3.6M rows / ~505MB uncompressed.
  const departures: StagedDeparture[] = [];
  const rl = createInterface({ input: createReadStream(path.join(workDir, "stop_times.txt"), "utf8") });
  let header: string[] | null = null;
  for await (const line of rl) {
    if (line.length === 0) continue;
    if (!header) {
      header = parseCsvHeader(line);
      continue;
    }
    const row = rowFromLine(header, line);
    const rows = buildDepartureRows(
      { stopId: row.stop_id ?? "", tripId: row.trip_id ?? "", arrivalTime: row.arrival_time ?? "", pickupType: row.pickup_type ?? "" },
      stopIdToHub,
      trips,
      routes,
      activeCalendars,
    );
    departures.push(...rows);
  }

  const stagedHubs: StagedHub[] = [...hubs.values()].map((hub) => ({
    gtfsStopId: hub.gtfsStopId,
    name: hub.name,
    mode: bundleMode,
    lat: hub.lat,
    lng: hub.lng,
  }));

  return { hubs: stagedHubs, departures };
}

// ---- main ----------------------------------------------------------------

interface ModeSummary {
  mode: string;
  status: "succeeded" | "skipped" | "failed" | "dry-run";
  hubs?: number;
  departures?: number;
  etag?: string | null;
  error?: string;
}

function printSummary(summaries: ModeSummary[]): void {
  console.log("\nmode".padEnd(38) + "status".padEnd(12) + "hubs".padEnd(8) + "departures");
  for (const s of summaries) {
    console.log(
      s.mode.padEnd(38) + s.status.padEnd(12) + String(s.hubs ?? "-").padEnd(8) + String(s.departures ?? "-"),
    );
    if (s.error) console.log(`  error: ${s.error}`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const rows = summaries
    .map((s) => `| ${s.mode} | ${s.status} | ${s.hubs ?? "-"} | ${s.departures ?? "-"} | ${s.etag ?? "-"} |`)
    .join("\n");
  appendFileSync(
    summaryPath,
    `## GTFS static import\n\n| mode | status | hubs | departures | etag |\n| --- | --- | --- | --- | --- |\n${rows}\n`,
  );
}

async function runCheckStaleness(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for --check-staleness");
  initSentry();
  const client = await connect(databaseUrl);
  try {
    const latestRuns = await getLatestRunsBySource(client, MODES);
    const result = checkStaleness(latestRuns, MODES, new Date(), STALENESS_MAX_AGE_DAYS);
    if (result.stale) {
      console.error(`STALE: no successful GTFS static import in the last ${STALENESS_MAX_AGE_DAYS} days for: ${result.staleSources.join(", ")}`);
      captureStalenessAlarm(result.staleSources);
      await flushSentry();
      process.exit(1);
    }
    console.log(`OK: all ${MODES.length} modes imported within the last ${STALENESS_MAX_AGE_DAYS} days.`);
  } finally {
    await client.end();
  }
}

// --dry-run: parse and report only, no DB connection at all — a smoke test
// of the download/parse path against the real TfNSW API.
async function runDryRun(modes: readonly string[]): Promise<ModeSummary[]> {
  const now = new Date();
  const workDirs: string[] = [];
  const summaries: ModeSummary[] = [];
  try {
    for (const mode of modes) {
      try {
        const downloaded = await downloadBundle(mode, null);
        if (downloaded.notModified) {
          // Unreachable with etagToCheck=null, but keeps the branch typed.
          summaries.push({ mode, status: "skipped" });
          continue;
        }
        workDirs.push(downloaded.workDir);
        const parsed = await parseBundle(downloaded.workDir, now);
        summaries.push({ mode, status: "dry-run", hubs: parsed.hubs.length, departures: parsed.departures.length, etag: downloaded.etag });
      } catch (err) {
        summaries.push({ mode, status: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
  }
  return summaries;
}

// Real import: every mode is downloaded and staged, then swapped into
// transit_hubs/scheduled_departures in the one transaction described at
// the top of this file. A mode that fails to download/parse is recorded as
// failed and excluded from the swap; it does not block the modes that
// succeeded.
async function runImport(client: Client, modes: readonly string[], force: boolean): Promise<ModeSummary[]> {
  const now = new Date();
  const workDirs: string[] = [];
  const summaries: ModeSummary[] = [];
  const pendingRuns = new Map<string, { runId: string; etag: string | null; departureCount: number }>();

  try {
    await createStagingTables(client);

    for (const mode of modes) {
      const runId = await startImportRun(client, mode);
      try {
        const lastEtag = force ? null : await getLastSuccessfulEtag(client, mode);
        const downloaded = await downloadBundle(mode, lastEtag);

        if (downloaded.notModified) {
          await finishImportRun(client, runId, { status: "skipped", sourceEtag: lastEtag });
          summaries.push({ mode, status: "skipped", etag: lastEtag });
          continue;
        }

        workDirs.push(downloaded.workDir);
        const parsed = await parseBundle(downloaded.workDir, now);
        await stageHubs(client, parsed.hubs);
        await stageDepartures(client, parsed.departures);
        pendingRuns.set(mode, { runId, etag: downloaded.etag, departureCount: parsed.departures.length });
        summaries.push({ mode, status: "succeeded", hubs: parsed.hubs.length, departures: parsed.departures.length, etag: downloaded.etag });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await finishImportRun(client, runId, { status: "failed", error: message });
        summaries.push({ mode, status: "failed", error: message });
      }
    }

    if (pendingRuns.size > 0) {
      try {
        await swapStagedData(client);
        for (const [, run] of pendingRuns) {
          await finishImportRun(client, run.runId, { status: "succeeded", rows: run.departureCount, sourceEtag: run.etag });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const [mode, run] of pendingRuns) {
          await finishImportRun(client, run.runId, { status: "failed", error: message });
          const summary = summaries.find((s) => s.mode === mode);
          if (summary) {
            summary.status = "failed";
            summary.error = message;
          }
        }
      }
    }
  } finally {
    for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
  }
  return summaries;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.checkStaleness) {
    await runCheckStaleness();
    return;
  }

  initSentry();
  try {
    let summaries: ModeSummary[];
    if (args.dryRun) {
      summaries = await runDryRun(args.modes);
    } else {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error("DATABASE_URL is required (unless running with --dry-run)");
      const client = await connect(databaseUrl);
      try {
        summaries = await runImport(client, args.modes, args.force);
      } finally {
        await client.end();
      }
    }
    printSummary(summaries);
    process.exit(summaries.some((s) => s.status === "failed") ? 1 : 0);
  } finally {
    await flushSentry();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
