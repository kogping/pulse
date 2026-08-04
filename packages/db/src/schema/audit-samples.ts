import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { curators } from "./curators";
import { venueAttributes } from "./venue-attributes";

// §9 audit tooling: a nightly random sample of venue-attributes (weighted
// toward stale ones), reviewed by a curator as correct/incorrect against
// reality. verdict is null until reviewed. Weekly accuracy % is derived
// from these rows via the audit_accuracy_weekly view (migration 0006) —
// not stored as a separate counter, same "computed, never stored"
// discipline as attribute_confidence().
export const auditSamples = pgTable(
  "audit_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueAttributeId: uuid("venue_attribute_id")
      .notNull()
      .references(() => venueAttributes.id, { onDelete: "cascade" }),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
    // 'correct' | 'incorrect', null while awaiting curator review.
    verdict: text("verdict"),
    reviewedBy: uuid("reviewed_by").references(() => curators.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("audit_samples_sampled_at_idx").on(table.sampledAt),
    index("audit_samples_verdict_idx").on(table.verdict),
  ],
);
