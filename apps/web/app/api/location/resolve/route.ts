import { PRECINCT_REGISTRY } from "@pulse/db";
import { getFlag, precinctFlag } from "@pulse/config";
import { NextResponse, type NextRequest } from "next/server";
import { haversineDistanceMeters } from "../../feed/geohash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Legacy (citywide_coverage_enabled off) behaviour only: beyond this
// distance from every enabled precinct's transit hub, a visitor is out of
// coverage rather than just "far from the centroid" — matches the scale of
// a single inner-Sydney precinct (a couple of km across).
const COVERAGE_RADIUS_METERS = 5_000;

interface ResolvedBody {
  status: "resolved";
  precinct: { id: string; name: string; lat: number; lng: number };
}

interface OutOfCoverageBody {
  status: "out_of_coverage";
}

async function nearestEnabledPrecinct(
  origin: { lat: number; lng: number },
): Promise<{ precinct: (typeof PRECINCT_REGISTRY)[number]; distanceMeters: number } | undefined> {
  const enabledPrecincts = await Promise.all(
    PRECINCT_REGISTRY.map(async (precinct) => ({
      precinct,
      enabled: await getFlag(precinctFlag(precinct.id)),
    })),
  ).then((entries) => entries.filter((entry) => entry.enabled).map((entry) => entry.precinct));

  return nearestOf(enabledPrecincts, origin);
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
// citywide_coverage_enabled off (default/legacy): only the original
// 2-precinct geofence — nearest *enabled* precinct within
// COVERAGE_RADIUS_METERS, else out_of_coverage. On: every visitor resolves
// to the nearest PRECINCT_REGISTRY entry regardless of distance or that
// entry's own precinct_<id>_enabled flag — the label is cosmetic now, not
// an access gate, because the feed itself is no longer scoped to a
// precinct (see packages/db/src/feed.ts). out_of_coverage can no longer be
// returned once the flag is on.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = params.get("lat");
  const lng = params.get("lng");

  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const origin = { lat: Number(lat), lng: Number(lng) };
  const citywideEnabled = await getFlag("citywide_coverage_enabled");

  if (citywideEnabled) {
    const nearest = nearestOf(PRECINCT_REGISTRY, origin);
    // Only reachable if PRECINCT_REGISTRY is ever empty, which it never is.
    if (!nearest) return NextResponse.json({ status: "out_of_coverage" } satisfies OutOfCoverageBody);
    return NextResponse.json({ status: "resolved", precinct: nearest.precinct } satisfies ResolvedBody);
  }

  const nearest = await nearestEnabledPrecinct(origin);
  if (!nearest || nearest.distanceMeters > COVERAGE_RADIUS_METERS) {
    return NextResponse.json({ status: "out_of_coverage" } satisfies OutOfCoverageBody);
  }

  return NextResponse.json({
    status: "resolved",
    precinct: nearest.precinct,
  } satisfies ResolvedBody);
}
