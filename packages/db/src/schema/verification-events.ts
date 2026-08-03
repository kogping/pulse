import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { curators } from "./curators";
import { venueAttributes } from "./venue-attributes";

// Append-only audit trail: every time a curator (re-)confirms an attribute,
// a row lands here and venue_attributes.last_verified_at is bumped.
export const verificationEvents = pgTable("verification_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueAttributeId: uuid("venue_attribute_id")
    .notNull()
    .references(() => venueAttributes.id, { onDelete: "cascade" }),
  curatorId: uuid("curator_id")
    .notNull()
    .references(() => curators.id, { onDelete: "restrict" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});
