import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "./env";

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql);

// Exposed for callers (e.g. the latency probe) that need a raw timed query
// without going through the Drizzle query builder.
export { sql };
