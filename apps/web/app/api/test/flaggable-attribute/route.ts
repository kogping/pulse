import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Test-only lookup for flag-roundtrip.spec.ts: finds a real seeded
// (venueId, attributeKey, precinct) whose confidence is fresh/ageing right
// now, i.e. one the venue detail page will actually render a flag control
// for. Deliberately independent of /api/feed's open-now filter (F1.1-F1.4)
// — that filter answers "is this venue open tonight", which has nothing to
// do with whether an attribute has a value to flag, and coupling the two
// made this lookup flaky depending on what time of day the suite runs.
// Gated on FEED_TEST_MODE, same convention as /api/test/flag-count.
export async function GET(request: NextRequest) {
  if (process.env.FEED_TEST_MODE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const precinct = request.nextUrl.searchParams.get("precinct");
  if (!precinct) return NextResponse.json({ error: "precinct is required" }, { status: 400 });

  const { db, venues, venueAttributes, attributeConfidence } = await import("@pulse/db");
  const { eq, sql } = await import("drizzle-orm");

  const rows = await db
    .select({
      venueId: venueAttributes.venueId,
      attributeKey: venueAttributes.attributeKey,
      lastVerifiedAt: venueAttributes.lastVerifiedAt,
      flagCount: sql<number>`(
        select count(*)::int from correction_flags cf
        where cf.venue_attribute_id = ${venueAttributes.id}
          and cf.flagged_at >= now() - interval '24 hours'
      )`,
    })
    .from(venueAttributes)
    .innerJoin(venues, eq(venues.id, venueAttributes.venueId))
    .where(eq(venues.precinct, precinct));

  const now = new Date();
  for (const row of rows) {
    const confidence = attributeConfidence({
      attributeKey: row.attributeKey,
      lastVerifiedAt: row.lastVerifiedAt,
      flagCount: row.flagCount,
      now,
    });
    if (confidence !== "unconfirmed") {
      return NextResponse.json({ venueId: row.venueId, attributeKey: row.attributeKey, precinct });
    }
  }

  return NextResponse.json({ error: "no flaggable attribute found" }, { status: 404 });
}
