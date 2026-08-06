import { bumpPrecinctFeedCacheVersion, insertCorrectionFlag, redis } from "@pulse/db";
import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { readSessionHash } from "../../../lib/session";
import { isOverFlagRateLimit } from "./rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "This looks wrong" (F3.x): a correction_flags insert, nothing else.
// Confidence is never written here — attributeConfidence() reads the flag
// count at query time (packages/db/src/freshness.ts) — so this route's only
// job is the insert, the rate limit gate in front of it, and nudging the
// feed cache so the badge's new confidence shows up before its 5-min TTL.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const venueId = typeof body?.venueId === "string" ? body.venueId : "";
  const attributeKey = typeof body?.attributeKey === "string" ? body.attributeKey : "";
  const reason = typeof body?.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim().slice(0, 280) : undefined;

  if (!venueId || !attributeKey) {
    return NextResponse.json({ error: "venueId and attributeKey are required" }, { status: 400 });
  }

  // No session cookie means middleware never saw this request (shouldn't
  // happen given its matcher covers /api/flag) — same optimistic response,
  // no write, rather than surfacing an error for something the tapper
  // didn't cause.
  const sessionHash = readSessionHash(request);
  if (!sessionHash) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Over the limit gets the same 200 the happy path returns — the UI can't
  // tell the difference, so an abuser can't tell either (CLAUDE.md: "do not
  // teach abusers where the wall is").
  if (await isOverFlagRateLimit(sessionHash)) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const result = await insertCorrectionFlag({ venueId, attributeKey, reporterSessionHash: sessionHash, reason });
  if (!result.ok) {
    return NextResponse.json({ error: "unknown venue attribute" }, { status: 400 });
  }

  try {
    await bumpPrecinctFeedCacheVersion(redis, result.precinct);
  } catch (error) {
    console.warn(`[flag] failed to invalidate feed cache for precinct "${result.precinct}"`, error);
    Sentry.captureException(error);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
