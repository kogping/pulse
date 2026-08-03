// Applies pending migrations from ../migrations against DATABASE_URL.
// Invoked exclusively from .github/workflows/migrate.yml on push to main
// (invariant: migrations run from GitHub Actions, never a Vercel build step).
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const db = drizzle(neon(databaseUrl));

await migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../migrations") });

console.log("Migrations applied.");
