import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { geographyPoint } from "./columns";

export const transitHubs = pgTable(
  "transit_hubs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // train | bus | ferry | light_rail | metro
    mode: text("mode").notNull(),
    location: geographyPoint("location").notNull(),
  },
  (table) => [index("transit_hubs_location_gist_idx").using("gist", table.location)],
);
