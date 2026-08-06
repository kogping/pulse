import { PRECINCT_REGISTRY } from "@pulse/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backs the precinct picker (denied/unavailable/slow-geolocation branches of
// F1.1): the list a visitor without a resolved location can choose from.
// Coverage is city-wide — every registry entry is offered.
export async function GET() {
  return NextResponse.json({
    precincts: PRECINCT_REGISTRY.map((precinct) => ({
      id: precinct.id,
      name: precinct.name,
      lat: precinct.lat,
      lng: precinct.lng,
    })),
  });
}
