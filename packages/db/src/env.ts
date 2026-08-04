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

let cached: Env | undefined;

// Parsed lazily on first use rather than at module import time. Next.js's
// "Collecting page data" build step imports every route module (even
// force-dynamic ones) to analyze it, which happens on a machine that
// intentionally has no real DATABASE_URL/UPSTASH_* creds (see CLAUDE.md:
// migrations run from GitHub Actions, never a Vercel build step). Eager
// parsing at import time made that analysis step fail the build. A missing
// or invalid var still throws before the first real query/command runs.
export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return cached;
}
