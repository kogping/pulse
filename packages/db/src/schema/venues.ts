import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { geographyPoint } from "./columns";

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    precinct: text("precinct").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    address: text("address"),
    // In-request only: used for ranking, never persisted beyond precinct +
    // geohash-5 elsewhere in the app (invariant: no precise location
    // persistence for *sessions*). The venue's own address point is fine
    // to store — it's a curated business location, not a user location.
    location: geographyPoint("location").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("venues_location_gist_idx").using("gist", table.location)],
);
