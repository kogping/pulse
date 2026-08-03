import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Auth.js magic-link identities for the ~10 allow-listed curator users.
export const curators = pgTable("curators", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
