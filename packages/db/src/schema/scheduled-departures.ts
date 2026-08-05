import { index, integer, pgTable, smallint, text, time, uuid } from "drizzle-orm/pg-core";
import { transitHubs } from "./transit-hubs";

// The static, published timetable — shown as a fallback labelled
// "scheduled, not live" whenever real-time departure data is missing,
// stale, or errored (invariant: degrade honestly, never guess a countdown).
//
// route/scheduledTime double as route_short_name/departs_at from the GTFS
// weekly import (scripts/gtfs-import.ts) — kept as expand-only additions
// rather than a rename, since a rename would need the two-PR destructive
// migration sequence for no behavioural gain.
export const scheduledDepartures = pgTable(
  "scheduled_departures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transitHubId: uuid("transit_hub_id")
      .notNull()
      .references(() => transitHubs.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    headsign: text("headsign"),
    // 0 = Sunday .. 6 = Saturday
    dayOfWeek: integer("day_of_week").notNull(),
    scheduledTime: time("scheduled_time").notNull(),
    // GTFS direction_id (0/1). Null for hand-seeded rows.
    direction: smallint("direction"),
    // GTFS calendar.txt as a 7-bit mask, bit0 = Sunday .. bit6 = Saturday,
    // for the day(s) this trip's service runs. One row per active day is
    // still stored (dayOfWeek above) so existing per-day queries keep
    // working; this mask is the provenance of that expansion.
    serviceDays: smallint("service_days"),
    // GTFS trip_id. Doubles as the ownership marker for the weekly import's
    // transactional swap (scripts/lib/gtfs/load.ts deletes and reinserts
    // only rows where this is set, leaving hand-entered rows untouched).
    gtfsTripId: text("gtfs_trip_id"),
  },
  (table) => [
    index("scheduled_departures_hub_day_idx").on(table.transitHubId, table.dayOfWeek),
    index("scheduled_departures_hub_day_time_idx").on(table.transitHubId, table.dayOfWeek, table.scheduledTime),
  ],
);
