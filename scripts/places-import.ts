// City-wide coverage — Google Places backfill.
//
// Curator-authored venues only exist where a curator has been (2 precincts
// at launch). Removing the geofence (apps/web/app/api/location/resolve)
// alone would give most of Sydney an empty feed, so this script pre-seeds
// suburbs with no curator presence from Google Places, tagged
// source: "google_places" (packages/db/src/schema/venues.ts). Those rows
// carry no attributes, no quality tier, no curator pitch — every badge
// therefore reads "unconfirmed" (packages/db/src/freshness.ts), never an
// invented value (CLAUDE.md invariant 3). A curator can later "claim" one
// through the console (apps/console/lib/venue-store.ts), which flips it to
// source: "curator" — see FEED_SCORING_WEIGHTS.source (packages/db/src/
// feed.ts) for how curated venues then outrank a same-distance Places one.
//
// Grid sweep over Greater Sydney: a circle per cell, recursing into 4
// quadrants at half radius when a cell hits the API's 20-result cap
// (Places API (New) searchNearby has no pagination) — see
// scripts/lib/places/parse.ts for the pure grid/shaping logic. Idempotent:
// upserts keyed on external_place_id, and NEVER touches a row a curator has
// since claimed (source = "curator") — the importer only ever writes rows
// it itself owns.
//
// Usage:
//   GOOGLE_PLACES_API_KEY=... DATABASE_URL=... pnpm places:import
//   GOOGLE_PLACES_API_KEY=... pnpm places:import --dry-run --max-requests=20
//   GOOGLE_PLACES_API_KEY=... DATABASE_URL=... pnpm places:import --bbox=151.24,-33.90,151.29,-33.87
//
// Invoked by .github/workflows/places-import.yml — NOT on Vercel (invariant:
// migrations/data loads run from GitHub Actions, never a Vercel build step).
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { generateSlug, getGooglePlacesEnv, PRECINCT_REGISTRY } from "@pulse/db";
import {
  buildGridCells,
  buildPrecinctCells,
  MAX_RESULTS_PER_CELL,
  MAX_SUBDIVISION_DEPTH,
  parseArgs,
  subdivide,
  toCandidate,
  type Cell,
  type CandidateVenue,
  type PlaceResult,
} from "./lib/places/parse";
import { flushSentry, initSentry } from "./lib/sentry";

// A cell that reliably reproduces (a comedy club precinct, a stadium event
// night) shouldn't be able to eat the whole run's budget on its own via
// deep subdivision — bounding the precinct-priority phase separately from
// `args.maxRequests` guarantees the general grid phase always gets *some*
// budget too, even if every one of the 26 registered precincts turned out
// to be maximally dense (worst case ~85 requests each, well under this cap).
const PRECINCT_PRIORITY_BUDGET_CAP = 1000;

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
// Google Places API (New) Table A types. No "darts" type exists — darts
// venues already surface under bar/pub/amusement_center by their primary
// type. Broad types like "restaurant" self-limit in practice: a venue only
// enters the feed if it has venue_hours covering "tonight" (see
// upsertCandidates's skippedNoHours), so a lunch-only restaurant just never
// shows up even though it gets imported.
const INCLUDED_TYPES = [
  "bar",
  "night_club",
  "pub",
  "wine_bar",
  "restaurant",
  "movie_theater",
  "karaoke",
  "bowling_alley",
  "amusement_center",
  "video_arcade",
  "comedy_club",
  "casino",
];
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
  "places.addressComponents",
  "places.regularOpeningHours",
  "places.businessStatus",
  "places.photos",
].join(",");

async function searchNearby(cell: Cell, apiKey: string): Promise<PlaceResult[]> {
  const res = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: INCLUDED_TYPES,
      maxResultCount: MAX_RESULTS_PER_CELL,
      locationRestriction: {
        circle: { center: { latitude: cell.lat, longitude: cell.lng }, radius: cell.radiusMeters },
      },
    }),
  });
  if (!res.ok) throw new Error(`Places searchNearby failed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { places?: PlaceResult[] };
  return body.places ?? [];
}

// Recurses into 4 quadrants at half radius whenever a cell comes back at
// the API's cap — that's the signal there are more venues than fit in one
// response, not that the cell genuinely only has 20. Bounded by
// MAX_SUBDIVISION_DEPTH so a pathologically dense cell (unlikely for
// nightlife venues, but possible near a stadium precinct) can't blow the
// request budget.
async function sweepCell(
  cell: Cell,
  apiKey: string,
  seen: Map<string, PlaceResult>,
  budget: { remaining: number },
): Promise<void> {
  if (budget.remaining <= 0) return;
  budget.remaining--;

  const results = await searchNearby(cell, apiKey);
  for (const place of results) seen.set(place.id, place);

  if (results.length >= MAX_RESULTS_PER_CELL && cell.depth < MAX_SUBDIVISION_DEPTH) {
    for (const child of subdivide(cell)) {
      if (budget.remaining <= 0) return;
      await sweepCell(child, apiKey, seen, budget);
    }
  }
}

// ---- DB upsert ----------------------------------------------------------

interface UpsertSummary {
  inserted: number;
  updated: number;
  skippedClaimed: number;
  skippedNoHours: number;
}

async function upsertCandidates(candidates: CandidateVenue[], dryRun: boolean): Promise<UpsertSummary> {
  const summary: UpsertSummary = { inserted: 0, updated: 0, skippedClaimed: 0, skippedNoHours: 0 };
  if (candidates.length === 0) return summary;
  if (dryRun) {
    // A venue with no regularOpeningHours never enters the feed (F1.1-F1.4's
    // open_now CTE requires venue_hours rows) — invariant 5, "degrade
    // honestly": we'd rather list nothing than guess a venue's hours.
    // Counted here too so --dry-run's report matches what a real run would
    // actually make visible.
    summary.skippedNoHours = candidates.filter((c) => c.hours.length === 0).length;
    return summary;
  }

  const { db, venues, venueHours } = await import("@pulse/db");
  const { eq, sql } = await import("drizzle-orm");

  for (const candidate of candidates) {
    const [existing] = await db
      .select({ id: venues.id, source: venues.source })
      .from(venues)
      .where(eq(venues.externalPlaceId, candidate.externalPlaceId))
      .limit(1);

    if (existing && existing.source !== "google_places") {
      // Claimed by a curator (apps/console's claim flow) — this importer
      // never overwrites a curator-authored row, even one it originally
      // seeded.
      summary.skippedClaimed++;
      continue;
    }

    const point = sql`ST_SetSRID(ST_MakePoint(${candidate.lng}, ${candidate.lat}), 4326)::geography`;
    const venueId = existing?.id ?? randomUUID();
    const slug = `${generateSlug(candidate.name)}-${candidate.externalPlaceId.slice(-6).toLowerCase()}`;

    if (existing) {
      await db
        .update(venues)
        .set({
          name: candidate.name,
          precinct: candidate.precinct,
          location: point,
          photoRef: candidate.photoRef,
          photoAttribution: candidate.photoAttribution,
          externalSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(venues.id, venueId));
      summary.updated++;
    } else {
      await db.insert(venues).values({
        id: venueId,
        precinct: candidate.precinct,
        name: candidate.name,
        slug,
        source: "google_places",
        externalPlaceId: candidate.externalPlaceId,
        externalSyncedAt: new Date(),
        location: point,
        photoRef: candidate.photoRef,
        photoAttribution: candidate.photoAttribution,
      });
      summary.inserted++;
    }

    await db.delete(venueHours).where(eq(venueHours.venueId, venueId));
    if (candidate.hours.length === 0) {
      summary.skippedNoHours++;
      continue;
    }
    for (const hour of candidate.hours) {
      await db.insert(venueHours).values({
        venueId,
        dayOfWeek: hour.dayOfWeek,
        isClosed: hour.isClosed,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
      });
    }
  }

  return summary;
}

// ---- import_runs bookkeeping ---------------------------------------------

const IMPORT_RUN_SOURCE = "google_places";

async function startImportRun(): Promise<string | null> {
  try {
    const { db, importRuns } = await import("@pulse/db");
    const [row] = await db.insert(importRuns).values({ source: IMPORT_RUN_SOURCE, status: "running" }).returning({ id: importRuns.id });
    return row?.id ?? null;
  } catch (error) {
    console.warn("[places-import] failed to record import_runs start", error);
    return null;
  }
}

async function finishImportRun(
  runId: string | null,
  result: { status: "succeeded" | "failed"; rows?: number; error?: string; cursor?: number },
): Promise<void> {
  if (!runId) return;
  try {
    const { db, importRuns } = await import("@pulse/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(importRuns)
      .set({ finishedAt: new Date(), status: result.status, rows: result.rows, error: result.error, cursor: result.cursor })
      .where(eq(importRuns.id, runId));
  } catch (error) {
    console.warn("[places-import] failed to record import_runs finish", error);
  }
}

// Where the general (non-precinct-priority) sweep phase should resume —
// the most recent run's cursor, regardless of whether that run ultimately
// succeeded or failed, so a crash mid-sweep still counts the ground already
// covered. 0 (start of the grid) if this is the first run ever, or the
// grid has grown/shrunk since the last recorded cursor.
async function readResumeCursor(cellCount: number): Promise<number> {
  try {
    const { db, importRuns } = await import("@pulse/db");
    const { and, desc, eq, isNotNull } = await import("drizzle-orm");
    const [row] = await db
      .select({ cursor: importRuns.cursor })
      .from(importRuns)
      .where(and(eq(importRuns.source, IMPORT_RUN_SOURCE), isNotNull(importRuns.cursor)))
      .orderBy(desc(importRuns.startedAt))
      .limit(1);
    const cursor = row?.cursor ?? 0;
    return cursor >= 0 && cursor < cellCount ? cursor : 0;
  } catch (error) {
    console.warn("[places-import] failed to read resume cursor, starting from 0", error);
    return 0;
  }
}

// Sweeps one top-level cell (and any quadrants it subdivides into) in
// isolation — a transient failure anywhere in that recursion (a 429, a
// network blip) no longer discards every place already found by every
// other cell this run. Errors are logged, not swallowed silently.
async function sweepCellSafely(cell: Cell, apiKey: string, seen: Map<string, PlaceResult>, budget: { remaining: number }): Promise<void> {
  try {
    await sweepCell(cell, apiKey, seen, budget);
  } catch (error) {
    console.warn(`[places-import] cell (${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)}) failed, continuing`, error);
  }
}

// ---- main ------------------------------------------------------------------

function mergeSummary(into: UpsertSummary, from: UpsertSummary): void {
  into.inserted += from.inserted;
  into.updated += from.updated;
  into.skippedClaimed += from.skippedClaimed;
  into.skippedNoHours += from.skippedNoHours;
}

function printSummary(
  precinctCellsSwept: number,
  generalCellsSwept: number,
  placesFound: number,
  summary: UpsertSummary,
  dryRun: boolean,
): void {
  console.log(`\nprecinct-priority cells swept: ${precinctCellsSwept}`);
  console.log(`general grid cells swept: ${generalCellsSwept}`);
  console.log(`places found: ${placesFound}`);
  console.log(`${dryRun ? "would insert" : "inserted"}: ${summary.inserted}`);
  console.log(`${dryRun ? "would update" : "updated"}: ${summary.updated}`);
  console.log(`skipped (claimed by a curator): ${summary.skippedClaimed}`);
  console.log(`no opening hours (won't appear in the feed): ${summary.skippedNoHours}`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(
    summaryPath,
    `## Places import\n\n| precinct cells | general cells | found | inserted | updated | skipped (claimed) | no hours |\n| --- | --- | --- | --- | --- | --- | --- |\n| ${precinctCellsSwept} | ${generalCellsSwept} | ${placesFound} | ${summary.inserted} | ${summary.updated} | ${summary.skippedClaimed} | ${summary.skippedNoHours} |\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { GOOGLE_PLACES_API_KEY } = getGooglePlacesEnv();
  if (!args.dryRun) {
    // Only touches DATABASE_URL — validated independently of the Places key
    // above, same rationale as packages/db/src/env.ts's per-concern getters.
    const { getDatabaseEnv } = await import("@pulse/db");
    getDatabaseEnv();
  }

  initSentry();
  const runId = args.dryRun ? null : await startImportRun();
  const summary: UpsertSummary = { inserted: 0, updated: 0, skippedClaimed: 0, skippedNoHours: 0 };
  let totalPlacesFound = 0;
  let nextCursor = 0;

  try {
    // Phase 1: every registered precinct's hub, unconditionally, every run —
    // see PRECINCT_PRIORITY_BUDGET_CAP for why this can't starve phase 2.
    const precinctCells = buildPrecinctCells(PRECINCT_REGISTRY);
    const precinctSeen = new Map<string, PlaceResult>();
    const precinctBudget = { remaining: Math.min(PRECINCT_PRIORITY_BUDGET_CAP, args.maxRequests) };
    for (const cell of precinctCells) {
      if (precinctBudget.remaining <= 0) break;
      await sweepCellSafely(cell, GOOGLE_PLACES_API_KEY, precinctSeen, precinctBudget);
    }
    const precinctCandidates = [...precinctSeen.values()].map(toCandidate).filter((c): c is CandidateVenue => c !== null);
    mergeSummary(summary, await upsertCandidates(precinctCandidates, args.dryRun));
    totalPlacesFound += precinctSeen.size;
    const requestsUsedByPrecinctPhase = Math.min(PRECINCT_PRIORITY_BUDGET_CAP, args.maxRequests) - precinctBudget.remaining;

    // Phase 2: the general city-wide grid, resuming from wherever the last
    // run's phase 2 left off (readResumeCursor), wrapping back to the start
    // once it reaches the end — a continuous, self-refreshing sweep of
    // everywhere else instead of a one-shot pass.
    const cells = buildGridCells(args.bbox);
    const startCursor = args.dryRun ? 0 : await readResumeCursor(cells.length);
    const generalSeen = new Map<string, PlaceResult>();
    const generalBudget = { remaining: Math.max(0, args.maxRequests - requestsUsedByPrecinctPhase) };
    let generalCellsSwept = 0;
    let cursor = startCursor;
    for (; generalCellsSwept < cells.length; generalCellsSwept++) {
      if (generalBudget.remaining <= 0) break;
      const cell = cells[cursor]!;
      await sweepCellSafely(cell, GOOGLE_PLACES_API_KEY, generalSeen, generalBudget);
      cursor = (cursor + 1) % cells.length;
    }
    nextCursor = cursor;
    const generalCandidates = [...generalSeen.values()].map(toCandidate).filter((c): c is CandidateVenue => c !== null);
    mergeSummary(summary, await upsertCandidates(generalCandidates, args.dryRun));
    totalPlacesFound += generalSeen.size;

    printSummary(precinctCells.length, generalCellsSwept, totalPlacesFound, summary, args.dryRun);

    await finishImportRun(runId, {
      status: "succeeded",
      rows: summary.inserted + summary.updated,
      cursor: args.dryRun ? undefined : nextCursor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort progress already survives via the two upsertCandidates
    // calls above (each phase writes before the other phase can fail) —
    // this only means something outside either sweep itself (e.g. the
    // final bookkeeping) broke. Persisting nextCursor even here means a
    // phase-2 cursor advance isn't lost just because something after it did.
    await finishImportRun(runId, { status: "failed", error: message, cursor: args.dryRun ? undefined : nextCursor });
    throw err;
  } finally {
    await flushSentry();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
