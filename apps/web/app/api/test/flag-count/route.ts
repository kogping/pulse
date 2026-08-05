import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Test-only introspection so flag-roundtrip.spec.ts's rate-limit assertion
// doesn't have to infer "no row was written" from an HTTP response that's
// deliberately identical whether or not the write happened (see
// app/api/flag/route.ts: rate-limited requests 200 the same as successful
// ones). Gated on FEED_TEST_MODE, which is already only ever set for the
// e2e webServer process (never on Vercel) — same convention as /api/feed's
// `_testNow`.
export async function GET(request: NextRequest) {
  if (process.env.FEED_TEST_MODE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const venueId = params.get("venueId");
  const attributeKey = params.get("attributeKey");
  if (!venueId || !attributeKey) {
    return NextResponse.json({ error: "venueId and attributeKey are required" }, { status: 400 });
  }

  const { db, venueAttributes, correctionFlags } = await import("@pulse/db");
  const { and, eq } = await import("drizzle-orm");

  const [attribute] = await db
    .select({ id: venueAttributes.id })
    .from(venueAttributes)
    .where(and(eq(venueAttributes.venueId, venueId), eq(venueAttributes.attributeKey, attributeKey)))
    .limit(1);
  if (!attribute) return NextResponse.json({ count: 0 });

  const rows = await db
    .select({ id: correctionFlags.id })
    .from(correctionFlags)
    .where(eq(correctionFlags.venueAttributeId, attribute.id));
  return NextResponse.json({ count: rows.length });
}
