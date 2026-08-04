import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { geographyPoint } from "./columns";
import { curators } from "./curators";

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    precinct: text("precinct").notNull(),
    name: text("name").notNull(),
    // Editable, but unique per precinct rather than globally (two precincts
    // can each have a venue slugged "the-lounge").
    slug: text("slug").notNull(),
    address: text("address"),
    // In-request only: used for ranking, never persisted beyond precinct +
    // geohash-5 elsewhere in the app (invariant: no precise location
    // persistence for *sessions*). The venue's own address point is fine
    // to store — it's a curated business location, not a user location.
    location: geographyPoint("location").notNull(),
    // Nullable at the DB layer (expand-only migration over pre-existing
    // rows) but required by the console's create/edit validation
    // (packages/db/src/venue-input.ts) for any venue saved through the form.
    qualityTier: text("quality_tier"),
    curatorPitch: text("curator_pitch"),
    // Attribution only — nullable because pre-existing rows predate this
    // column. Set once at creation, never reassigned on edit (contribution
    // counting attributes edits separately, via verification_events).
    createdBy: uuid("created_by").references(() => curators.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("venues_location_gist_idx").using("gist", table.location),
    uniqueIndex("venues_precinct_slug_idx").on(table.precinct, table.slug),
  ],
);
