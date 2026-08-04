import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { curators } from "./curators";
import { venueAttributes } from "./venue-attributes";

// Append-only audit trail: every time a curator (re-)confirms or corrects an
// attribute, a row lands here and venue_attributes.last_verified_at is
// bumped. Also the write path for the verification queue (F0.1/F0.2).
export const verificationEvents = pgTable(
  "verification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueAttributeId: uuid("venue_attribute_id")
      .notNull()
      .references(() => venueAttributes.id, { onDelete: "cascade" }),
    curatorId: uuid("curator_id")
      .notNull()
      .references(() => curators.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    // 'confirm' | 'correct' | 'revert' — see packages/db/src/queue.ts. Rows
    // written before this column existed are all confirms, hence the default.
    action: text("action").notNull().default("confirm"),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    // Client-measured item-shown -> submit time, in milliseconds. Feeds the
    // /ops dashboard's per-item timing aggregates.
    durationMs: integer("duration_ms"),
    // Client-generated idempotency key (crypto.randomUUID()) for the
    // offline outbox (apps/console/lib/outbox.ts). A flush that lands twice
    // — e.g. the response was lost on a flaky 4G link — is deduped here,
    // never on (venue_attribute_id, curator_id): two confirms an hour apart
    // are legitimately distinct events and must both land.
    clientActionId: text("client_action_id"),
  },
  (table) => [
    uniqueIndex("verification_events_client_action_id_idx")
      .on(table.clientActionId)
      .where(sql`${table.clientActionId} is not null`),
    index("verification_events_verified_at_idx").on(table.verifiedAt),
  ],
);
