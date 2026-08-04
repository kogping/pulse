import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { curators } from "./curators";

// Auth.js database session strategy: one row per active session, 30-day
// rolling expiry (extended on each validated request — see lib/auth.ts).
export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  curatorId: uuid("curator_id")
    .notNull()
    .references(() => curators.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

// Single-use magic-link tokens for the Email provider. A row is deleted as
// soon as it's redeemed (see useVerificationToken in lib/auth.ts).
export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);
