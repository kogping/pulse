import { NextResponse } from "next/server";
import { getTestQueueState, seedTestQueue } from "@/lib/queue-store";

// Test-only introspection/seed endpoint, mirroring app/api/test/inbox/route.ts:
// 404 unless AUTH_TEST_MODE is set, so it never exists as an attack surface
// in production. middleware.ts already allow-lists /api/test/.
export async function POST(request: Request) {
  if (process.env.AUTH_TEST_MODE !== "1") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { size?: number };
  return NextResponse.json({ items: seedTestQueue(body.size ?? 20) });
}

export async function GET() {
  if (process.env.AUTH_TEST_MODE !== "1") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(getTestQueueState());
}
