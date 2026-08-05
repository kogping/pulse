import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { geographyPoint } from "./columns";

export const transitHubs = pgTable(
  "transit_hubs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // train | bus | ferry | light_rail | metro
    mode: text("mode").notNull(),
    location: geographyPoint("location").notNull(),
    // GTFS stop_id of the parent station, set only for hubs created by
    // scripts/gtfs-import.ts. Null for hand-seeded hubs. The upsert key
    // that makes the weekly import idempotent — see scripts/lib/gtfs/load.ts.
    gtfsStopId: text("gtfs_stop_id"),
  },
  (table) => [
    index("transit_hubs_location_gist_idx").using("gist", table.location),
    uniqueIndex("transit_hubs_gtfs_stop_id_idx").on(table.gtfsStopId),
  ],
);
