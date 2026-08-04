import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Auth.js magic-link identities for the ~10 allow-listed curator users.
// Adding a curator is an INSERT into this table — see docs/runbook/curators.md.
export const curators = pgTable("curators", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Sign-in is permitted only for rows with active = true. Deactivating a
  // curator is a flip of this flag, not a delete (preserves attribution on
  // past verification events).
  active: boolean("active").notNull().default(true),
  // Free-text precinct label, matching venues.precinct — no FK, no lookup
  // table (see venues.ts for the same convention).
  precinctId: text("precinct_id"),
  tier: text("tier").notNull().default("standard"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
