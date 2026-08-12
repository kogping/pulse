import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getGooglePlacesEnv, getVenuePhotoRef } from "@pulse/db";

// Region is set app-wide by apps/web/vercel.json's regions:["syd1"]
// (CLAUDE.md invariant #1) — every function in this app runs there.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACES_BASE_URL = "https://places.googleapis.com/v1";
const MAX_WIDTH_PX = 800;
const FETCH_TIMEOUT_MS = 4000;

// Streams a venue's Google Places photo through this server function so
// GOOGLE_PLACES_API_KEY never reaches the browser. Only photoRef (the
// Places photo resource name) is ever stored on venues — this is the one
// place that resolves it to actual image bytes, on every request, so a
// stale/expired Places-side reference degrades to a 404 rather than a
// broken cached image (CLAUDE.md invariant #5 applied to media, not just
// badge values).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  if (!venueId) return NextResponse.json({ error: "venueId is required" }, { status: 400 });

  const photoRef = await getVenuePhotoRef(venueId);
  if (!photoRef) return NextResponse.json({ error: "no photo for this venue" }, { status: 404 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // getGooglePlacesEnv() is called inside the try, not before it — it
    // throws (via zod) when GOOGLE_PLACES_API_KEY is unset, and this route
    // runs on every request in apps/web, unlike the getter's other caller
    // (scripts/places-import.ts, a GitHub Actions job). A missing key must
    // degrade to the same honest 404 as any other photo failure below, not
    // an unhandled 500 (CLAUDE.md invariant #5).
    const { GOOGLE_PLACES_API_KEY } = getGooglePlacesEnv();
    const res = await fetch(`${PLACES_BASE_URL}/${photoRef}/media?maxWidthPx=${MAX_WIDTH_PX}&key=${GOOGLE_PLACES_API_KEY}`, {
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      Sentry.captureMessage("[venue-photo] Places media fetch failed", { level: "warning", extra: { venueId, status: res.status } });
      return NextResponse.json({ error: "photo unavailable" }, { status: 404 });
    }

    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Public and cacheable — the resolved image itself is stable even
        // though photoRef could theoretically change on a later import run.
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "photo unavailable" }, { status: 404 });
  } finally {
    clearTimeout(timeout);
  }
}
