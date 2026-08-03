import type { Config } from "drizzle-kit";

// drizzle-kit only needs a syntactically valid connection string to generate
// migrations from the schema — it does not connect unless you run
// `drizzle-kit push` or `migrate`. Real credentials come from the
// DATABASE_URL secret in CI / Vercel.
export default {
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
} satisfies Config;
