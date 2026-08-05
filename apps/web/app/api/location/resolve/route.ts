import { PRECINCT_REGISTRY } from "@pulse/db";
import { getFlag, precinctFlag } from "@pulse/config";
import { NextResponse, type NextRequest } from "next/server";
import { haversineDistanceMeters } from "../../feed/geohash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Beyond this distance from every enabled precinct's transit hub, a visitor
// is out of coverage rather than just "far from the centroid" — matches the
// scale of a single inner-Sydney precinct (a couple of km across).
const COVERAGE_RADIUS_METERS = 5_000;

interface ResolvedBody {
  status: "resolved";
  precinct: { id: string; name: string; lat: number; lng: number };
}

interface OutOfCoverageBody {
  status: "out_of_coverage";
}

// The granted-geolocation branch of F1.1: given a visitor's coordinates,
// finds the nearest *enabled* precinct within COVERAGE_RADIUS_METERS.
// Coordinates arrive as query params, are used only to compute a distance
// in this handler, and are never written anywhere or echoed back —
// CLAUDE.md invariant 6, "the request carries them, the response is
// computed, they are dropped".
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = params.get("lat");
  const lng = params.get("lng");

  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const origin = { lat: Number(lat), lng: Number(lng) };

  const enabledPrecincts = await Promise.all(
    PRECINCT_REGISTRY.map(async (precinct) => ({
      precinct,
      enabled: await getFlag(precinctFlag(precinct.id)),
    })),
  ).then((entries) => entries.filter((entry) => entry.enabled).map((entry) => entry.precinct));

  let nearest: { precinct: (typeof PRECINCT_REGISTRY)[number]; distanceMeters: number } | undefined;
  for (const precinct of enabledPrecincts) {
    const distanceMeters = haversineDistanceMeters(origin, precinct);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { precinct, distanceMeters };
    }
  }

  if (!nearest || nearest.distanceMeters > COVERAGE_RADIUS_METERS) {
    return NextResponse.json({ status: "out_of_coverage" } satisfies OutOfCoverageBody);
  }

  return NextResponse.json({
    status: "resolved",
    precinct: nearest.precinct,
  } satisfies ResolvedBody);
}
