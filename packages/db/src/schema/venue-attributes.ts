import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { curators } from "./curators";
import { venues } from "./venues";

// Base table for curated venue attributes (vibe, dress code, cover charge,
// queue length, ...). Confidence is NEVER stored here — it's a pure
// function of (attribute_key, last_verified_at, flag_count, now()),
// exposed only through the venue_attributes_resolved view. Application
// code must read the view, never this table, for display.
export const venueAttributes = pgTable(
  "venue_attributes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    attributeKey: text("attribute_key").notNull(),
    value: text("value").notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedBy: uuid("verified_by").references(() => curators.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("venue_attributes_venue_key_idx").on(table.venueId, table.attributeKey)],
);
