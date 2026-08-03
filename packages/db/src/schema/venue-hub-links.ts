import { integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { transitHubs } from "./transit-hubs";
import { venues } from "./venues";

export const venueHubLinks = pgTable(
  "venue_hub_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    transitHubId: uuid("transit_hub_id")
      .notNull()
      .references(() => transitHubs.id, { onDelete: "cascade" }),
    walkMinutes: integer("walk_minutes").notNull(),
  },
  (table) => [uniqueIndex("venue_hub_links_venue_hub_idx").on(table.venueId, table.transitHubId)],
);
