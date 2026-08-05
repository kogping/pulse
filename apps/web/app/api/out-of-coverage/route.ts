import { recordOutOfCoverageSignup } from "@pulse/db";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Out-of-coverage email capture (F1.1). Body is { email, suburb } — suburb
// is what the visitor typed in the out-of-coverage screen, never derived
// from their coordinates (nothing upstream of this route ever has both the
// visitor's coordinates and a persistence call in the same place). No
// account is created; this is a bare insert into out_of_coverage_signups.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const suburb = typeof body?.suburb === "string" ? body.suburb.trim() : "";

  if (!EMAIL_PATTERN.test(email) || suburb.length === 0) {
    return NextResponse.json({ error: "a valid email and suburb are required" }, { status: 400 });
  }

  await recordOutOfCoverageSignup({ email, suburb });

  return NextResponse.json({ ok: true }, { status: 201 });
}
