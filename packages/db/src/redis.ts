import { Redis } from "@upstash/redis";
import { getEnv } from "./env";
import { lazy } from "./lazy";

export const redis = lazy<Redis>(
  () =>
    new Redis({
      url: getEnv().UPSTASH_REDIS_REST_URL,
      token: getEnv().UPSTASH_REDIS_REST_TOKEN,
    }),
);
