import { Redis } from "@upstash/redis";
import { getUpstashEnv } from "./env";
import { lazy } from "./lazy";

export const redis = lazy<Redis>(() => {
  const env = getUpstashEnv();
  return new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
});
