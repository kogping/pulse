import { getFeedVenuesWithLocation, redis } from "@pulse/db";
import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getFeedWithCache, type FeedCacheMetricEvent } from "./feed-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-instance, best-effort hit-rate counter — resets on cold start, which
// is fine for a rolling console/Sentry signal rather than a durable metric.
let cacheHits = 0;
let cacheRequests = 0;

function recordFeedCacheMetric(event: FeedCacheMetricEvent): void {
  cacheRequests++;
  if (event === "hit") cacheHits++;
  console.log("[feed-cache] metric", { event, hitRate: cacheHits / cacheRequests, cacheRequests });
}

// F1.1-F1.4 read path. `_testNow` lets the e2e suite simulate an arbitrary
// instant (e.g. 2:15am) against real seeded data — it's only honoured when
// FEED_TEST_MODE is set, which playwright.config.ts sets for the e2e
// webServer process and nothing else ever does (never set on Vercel), so a
// real visitor can never spoof the clock a badge's freshness is judged
// against.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const precinct = params.get("precinct");
  const lat = params.get("lat");
  const lng = params.get("lng");

  if (!precinct || !lat || !lng) {
    return NextResponse.json({ error: "precinct, lat and lng are required" }, { status: 400 });
  }

  const radiusMeters = params.get("radiusMeters");
  const limit = params.get("limit");
  const testNow = params.get("_testNow");

  const { venues } = await getFeedWithCache(
    {
      precinct,
      lat: Number(lat),
      lng: Number(lng),
      radiusMeters: radiusMeters ? Number(radiusMeters) : undefined,
      limit: limit ? Number(limit) : undefined,
      now: testNow && process.env.FEED_TEST_MODE === "1" ? new Date(testNow) : undefined,
    },
    {
      redis,
      fetchVenues: getFeedVenuesWithLocation,
      logger: {
        warn: (message, meta) => Sentry.captureMessage(`[feed-cache] ${message}`, { level: "warning", extra: meta }),
      },
      recordMetric: recordFeedCacheMetric,
    },
  );

  return NextResponse.json({ venues });
}
