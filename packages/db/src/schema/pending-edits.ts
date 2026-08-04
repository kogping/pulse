import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { curators } from "./curators";
import { venueAttributes } from "./venue-attributes";
import { venues } from "./venues";

// Edits made by a curator with a declared conflict of interest (see
// curator-venue-interests.ts) land here instead of being applied to
// venue_attributes directly. A second curator (not the author) must approve
// before the edit takes effect. Until then venue_attributes — and therefore
// every read path, curator or public — keeps showing the pre-edit value.
export const pendingEdits = pgTable(
  "pending_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueAttributeId: uuid("venue_attribute_id")
      .notNull()
      .references(() => venueAttributes.id, { onDelete: "cascade" }),
    // Denormalized from venue_attributes.venue_id at write time so the
    // approval queue can list/filter by venue without a join back through
    // an attribute that may itself have moved on.
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    curatorId: uuid("curator_id")
      .notNull()
      .references(() => curators.id, { onDelete: "restrict" }),
    previousValue: text("previous_value").notNull(),
    newValue: text("new_value").notNull(),
    note: text("note"),
    durationMs: integer("duration_ms"),
    // Same idempotency contract as verification_events.client_action_id —
    // the offline outbox may flush this action twice.
    clientActionId: text("client_action_id"),
    // 'pending' | 'approved' | 'rejected'.
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => curators.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pending_edits_client_action_id_idx")
      .on(table.clientActionId)
      .where(sql`${table.clientActionId} is not null`),
    index("pending_edits_status_idx").on(table.status),
  ],
);
