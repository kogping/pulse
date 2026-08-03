import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .startsWith("postgresql://", "DATABASE_URL must be a postgresql:// connection string"),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

// Parsed eagerly at import time so a missing/invalid var throws at boot
// (cold start), not on first query inside a request handler.
export const env: Env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
});
