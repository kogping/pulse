import { describe, expect, it } from "vitest";
import { z } from "zod";

// Re-declared rather than imported: importing ./env parses process.env at
// module load, which would make this test depend on process.env state set
// up before vitest even starts.
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .startsWith("postgresql://", "DATABASE_URL must be a postgresql:// connection string"),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  MAPBOX_TOKEN: z.string().min(1),
});

describe("env schema", () => {
  const valid = {
    DATABASE_URL: "postgresql://user:pass@host.ap-southeast-2.aws.neon.tech/neondb?sslmode=require",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token",
    MAPBOX_TOKEN: "token",
  };

  it("accepts a fully populated, valid env", () => {
    expect(() => envSchema.parse(valid)).not.toThrow();
  });

  it("throws when DATABASE_URL is missing", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.DATABASE_URL;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it("throws when DATABASE_URL is not a postgresql:// URL", () => {
    expect(() => envSchema.parse({ ...valid, DATABASE_URL: "mysql://host/db" })).toThrow();
  });

  it("throws when UPSTASH_REDIS_REST_URL is missing", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.UPSTASH_REDIS_REST_URL;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it("throws when UPSTASH_REDIS_REST_TOKEN is empty", () => {
    expect(() => envSchema.parse({ ...valid, UPSTASH_REDIS_REST_TOKEN: "" })).toThrow();
  });
});
