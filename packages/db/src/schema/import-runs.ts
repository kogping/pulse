import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Bookkeeping for scripts/gtfs-import.ts (F3.3 weekly static timetable
// import). One row per GTFS mode bundle per run, written outside the
// transactional staging swap so a failed import still leaves a record of
// having failed. Read by --check-staleness to fail the workflow (and page
// Sentry) if a mode hasn't succeeded or been skipped-as-unchanged in 10 days.
export const importRuns = pgTable(
  "import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // GTFS mode bundle slug, e.g. "sydneytrains", "lightrail/innerwest".
    source: text("source").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rows: integer("rows"),
    // Upstream ETag of the downloaded bundle, used to skip re-downloading
    // and re-parsing an unchanged bundle on the next run.
    sourceEtag: text("source_etag"),
    // 'running' | 'succeeded' | 'skipped' | 'failed'. 'skipped' means the
    // ETag matched the last success, so nothing was re-imported — it still
    // counts as fresh for the staleness check.
    status: text("status").notNull(),
    error: text("error"),
  },
  (table) => [index("import_runs_source_started_at_idx").on(table.source, table.startedAt)],
);
