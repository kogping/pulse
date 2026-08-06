import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { geographyPoint } from "./columns";
import { curators } from "./curators";

// "curator" rows are hand-authored via the console (see createdBy below).
// "google_places" rows are written only by scripts/places-import.ts, carry
// no attributes/verification events, and so read as fully unconfirmed —
// see packages/db/src/provenance.ts and freshness.ts. A curator claiming one
// via the console flips this to "curator" (apps/console venue-store.ts).
export const VENUE_SOURCES = ["curator", "google_places"] as const;
export type VenueSource = (typeof VENUE_SOURCES)[number];

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Free-text display label — historically a precinct name ("Newtown"),
    // now more generally "the suburb this venue is in" for city-wide
    // coverage (see packages/db/src/precincts.ts). Not a foreign key.
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
    // Defaults "curator" so every pre-existing row (all hand-authored) is
    // correctly attributed with no backfill needed — expand-only migration.
    source: text("source").notNull().default("curator"),
    // Google Places place id. Null for curator-authored venues. The unique
    // partial index below is what makes places-import.ts's upsert-by-place-id
    // idempotent across repeated runs.
    externalPlaceId: text("external_place_id"),
    externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),
    // Google Places photo resource name (e.g. "places/.../photos/..."), set
    // only by scripts/places-import.ts. Not a displayable URL by itself —
    // resolved on read via apps/web's /api/venue-photo proxy, which is what
    // keeps GOOGLE_PLACES_API_KEY server-side.
    photoRef: text("photo_ref"),
    // Google-required attribution text for photoRef (Places API ToS). Null
    // whenever photoRef is null.
    photoAttribution: text("photo_attribution"),
    // Curator-pasted direct image URL, set only through the console. Takes
    // priority over photoRef when both are present (see provenance.ts's
    // VenuePhoto) — a curator's choice overrides an unverified Places photo.
    photoUrl: text("photo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("venues_location_gist_idx").using("gist", table.location),
    uniqueIndex("venues_precinct_slug_idx").on(table.precinct, table.slug),
    index("venues_source_idx").on(table.source),
    uniqueIndex("venues_external_place_id_idx")
      .on(table.externalPlaceId)
      .where(sql`${table.externalPlaceId} is not null`),
    check("venues_source_check", sql`${table.source} in ('curator', 'google_places')`),
  ],
);
