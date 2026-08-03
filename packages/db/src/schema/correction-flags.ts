import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { venueAttributes } from "./venue-attributes";

// Public "this looks wrong" reports from the anonymous web PWA. reporterSessionHash
// is an anonymous rotating session hash (invariant: no precise location or
// identity persistence for web sessions) — never a stable user identifier.
export const correctionFlags = pgTable(
  "correction_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueAttributeId: uuid("venue_attribute_id")
      .notNull()
      .references(() => venueAttributes.id, { onDelete: "cascade" }),
    reporterSessionHash: text("reporter_session_hash").notNull(),
    reason: text("reason"),
    flaggedAt: timestamp("flagged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Backs the flag-count-in-last-24h subquery used by
  // venue_attributes_resolved to compute confidence.
  (table) => [index("correction_flags_attribute_flagged_idx").on(table.venueAttributeId, table.flaggedAt)],
);
