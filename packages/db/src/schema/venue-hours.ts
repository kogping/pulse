import { boolean, integer, pgTable, time, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { venues } from "./venues";

// One row per day-of-week per venue. Represents the scheduled timetable
// shown when live status is unavailable (invariant: degrade honestly).
export const venueHours = pgTable(
  "venue_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    // 0 = Sunday .. 6 = Saturday
    dayOfWeek: integer("day_of_week").notNull(),
    opensAt: time("opens_at"),
    // May be earlier than opensAt (e.g. opens 22:00, closes 03:00) — a
    // past-midnight close, not a data error. Confidence/read paths must
    // compare these as opaque HH:mm strings, never assume closesAt > opensAt.
    closesAt: time("closes_at"),
    // Kitchen often stops service well before the room itself closes;
    // tracked separately so "scheduled, not live" hours can show both.
    kitchenClosesAt: time("kitchen_closes_at"),
    isClosed: boolean("is_closed").notNull().default(false),
  },
  (table) => [uniqueIndex("venue_hours_venue_day_idx").on(table.venueId, table.dayOfWeek)],
);
