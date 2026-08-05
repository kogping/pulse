import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@pulse/db";

// "5 flags per hour, 20 per day" per reporter_session_hash. Two independent
// fixed windows rather than one — the hourly window is the one a curious
// double-tapper actually hits; the daily window exists for the same session
// hash coming back across an evening. Both are keyed by the same session
// hash, distinct prefixes so they don't share a bucket.
const hourly = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(5, "1 h"), prefix: "flag_rl:hour", analytics: false });
const daily = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(20, "1 d"), prefix: "flag_rl:day", analytics: false });

// Fails open on a Redis outage — matches feed-cache.ts's "cache failures
// fall through, never a 500" contract. A rate limit that can't be checked
// is not a reason to block every "this looks wrong" tap for the evening.
export async function isOverFlagRateLimit(sessionHash: string): Promise<boolean> {
  try {
    const [hour, day] = await Promise.all([hourly.limit(sessionHash), daily.limit(sessionHash)]);
    return !hour.success || !day.success;
  } catch (error) {
    console.warn("[flag-rate-limit] redis unreachable; allowing", error);
    return false;
  }
}
