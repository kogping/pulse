import { index, integer, pgTable, text, time, uuid } from "drizzle-orm/pg-core";
import { transitHubs } from "./transit-hubs";

// The static, published timetable — shown as a fallback labelled
// "scheduled, not live" whenever real-time departure data is missing,
// stale, or errored (invariant: degrade honestly, never guess a countdown).
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
  },
  (table) => [index("scheduled_departures_hub_day_idx").on(table.transitHubId, table.dayOfWeek)],
);
