import { boolean, integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // Deprecated in favour of walkSeconds (finer-grained, matches Mapbox
    // Directions' native unit). Left nullable rather than dropped — dropping
    // it is a destructive change requiring the two-PR expand/contract
    // sequence (CLAUDE.md invariant #4) for no behavioural gain today.
    walkMinutes: integer("walk_minutes"),
    walkSeconds: integer("walk_seconds").notNull(),
    // Lowest walkSeconds among hubs with meaningful late-night service, or
    // (if none of a venue's linked hubs run late) the lowest walkSeconds
    // overall. Exactly one true per venue — see hub-links.ts.
    isPrimary: boolean("is_primary").notNull().default(false),
    // True when walkSeconds came from the straight-line-distance fallback
    // (Mapbox Directions failed, timed out, or errored) rather than a real
    // routed walking path. Re-attempted by scripts/backfill-walk-times.ts.
    isEstimated: boolean("is_estimated").notNull().default(false),
  },
  (table) => [uniqueIndex("venue_hub_links_venue_hub_idx").on(table.venueId, table.transitHubId)],
);
