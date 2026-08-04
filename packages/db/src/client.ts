import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "./env";
import { lazy } from "./lazy";

// Exposed for callers (e.g. the latency probe) that need a raw timed query
// without going through the Drizzle query builder.
export const sql = lazy<NeonQueryFunction<false, false>>(() => neon(getEnv().DATABASE_URL));

export const db = lazy<NeonHttpDatabase>(() => drizzle(sql));
