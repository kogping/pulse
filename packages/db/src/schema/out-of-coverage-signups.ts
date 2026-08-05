import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// "Notify me when you launch here" capture for visitors whose resolved
// location falls outside every enabled precinct (F1.1 out-of-coverage
// branch). Single email field plus the free-text suburb the visitor typed —
// never the coordinates that triggered the screen (CLAUDE.md invariant 6:
// coordinates are used in-request and discarded). No account is created;
// this table has no relation to curators or any auth identity.
export const outOfCoverageSignups = pgTable("out_of_coverage_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  suburb: text("suburb").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
