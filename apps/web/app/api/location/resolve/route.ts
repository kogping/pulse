import { PRECINCT_REGISTRY } from "@pulse/db";
import { NextResponse, type NextRequest } from "next/server";
import { haversineDistanceMeters } from "../../feed/geohash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResolvedBody {
  status: "resolved";
  precinct: { id: string; name: string; lat: number; lng: number };
}

function nearestOf(
  precincts: readonly (typeof PRECINCT_REGISTRY)[number][],
  origin: { lat: number; lng: number },
): { precinct: (typeof PRECINCT_REGISTRY)[number]; distanceMeters: number } | undefined {
  let nearest: { precinct: (typeof PRECINCT_REGISTRY)[number]; distanceMeters: number } | undefined;
  for (const precinct of precincts) {
    const distanceMeters = haversineDistanceMeters(origin, precinct);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { precinct, distanceMeters };
    }
  }
  return nearest;
}

// The granted-geolocation branch of F1.1: given a visitor's coordinates,
// resolves to an area label for display. Coordinates arrive as query
// params, are used only to compute a distance in this handler, and are
// never written anywhere or echoed back — CLAUDE.md invariant 6, "the
// request carries them, the response is computed, they are dropped".
//
// Coverage is city-wide (see "feat: city-wide Sydney coverage"): every
// visitor resolves to the nearest PRECINCT_REGISTRY entry regardless of
// distance — the label is cosmetic, not an access gate, because the feed
// itself is no longer scoped to a precinct (see packages/db/src/feed.ts).
// There is no out-of-coverage outcome as long as PRECINCT_REGISTRY is
// non-empty, which it always is.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = params.get("lat");
  const lng = params.get("lng");

  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const origin = { lat: Number(lat), lng: Number(lng) };
  const nearest = nearestOf(PRECINCT_REGISTRY, origin);

  // Only reachable if PRECINCT_REGISTRY is ever empty, which it never is.
  if (!nearest) {
    return NextResponse.json({ error: "no precinct registered" }, { status: 500 });
  }

  return NextResponse.json({ status: "resolved", precinct: nearest.precinct } satisfies ResolvedBody);
}
