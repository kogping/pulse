import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { curators } from "./curators";
import { venues } from "./venues";

// A curator's declared conflict of interest in a venue (e.g. they own it, a
// friend runs it). Declaring one removes that venue from the curator's own
// queue (queue.ts) and forces any edit they make to it through a second
// curator's approval (see pending-edits.ts) rather than applying directly.
export const curatorVenueInterests = pgTable(
  "curator_venue_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    curatorId: uuid("curator_id")
      .notNull()
      .references(() => curators.id, { onDelete: "cascade" }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    nature: text("nature").notNull(),
    declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("curator_venue_interests_curator_venue_idx").on(table.curatorId, table.venueId)],
);
