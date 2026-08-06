import { NextResponse } from "next/server";
import { requireCuratorSession } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";

// A curator declares their own conflict of interest — there is no
// admin-on-behalf-of-another-curator path, so this always writes against
// the signed-in session's curatorId, never a body-supplied one.
export async function POST(request: Request) {
  const session = await requireCuratorSession();
  if (session instanceof NextResponse) return session;

  const body = (await request.json().catch(() => null)) as { venueId?: string; nature?: string } | null;
  if (!body?.venueId || !body.nature) {
    return NextResponse.json({ error: "expected { venueId, nature }" }, { status: 400 });
  }

  await queueStore.declareInterest(session.curatorId, body.venueId, body.nature);
  return NextResponse.json({ ok: true });
}
