import { PRECINCT_REGISTRY } from "@pulse/db";
import { getFlag, precinctFlag } from "@pulse/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backs the precinct picker (denied/unavailable/slow-geolocation branches of
// F1.1): the list a visitor without a resolved location can choose from.
//
// citywide_coverage_enabled off (legacy): only precincts whose Edge Config
// `precinct_<id>_enabled` flag is on are returned — an unlaunched precinct
// in PRECINCT_REGISTRY must stay unreachable even by manual pick, same as
// it's unreachable by geolocation (see /api/location/resolve). On: every
// registry entry is offered — the per-precinct flag no longer gates access,
// it only ever gated the old geofence.
export async function GET() {
  const citywideEnabled = await getFlag("citywide_coverage_enabled");
  if (citywideEnabled) {
    return NextResponse.json({
      precincts: PRECINCT_REGISTRY.map((precinct) => ({
        id: precinct.id,
        name: precinct.name,
        lat: precinct.lat,
        lng: precinct.lng,
      })),
    });
  }

  const enabled = await Promise.all(
    PRECINCT_REGISTRY.map(async (precinct) => ({
      precinct,
      enabled: await getFlag(precinctFlag(precinct.id)),
    })),
  );

  return NextResponse.json({
    precincts: enabled
      .filter((entry) => entry.enabled)
      .map(({ precinct }) => ({ id: precinct.id, name: precinct.name, lat: precinct.lat, lng: precinct.lng })),
  });
}
