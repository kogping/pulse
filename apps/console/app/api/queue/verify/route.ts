import { NextResponse } from "next/server";
import { requireCuratorSession } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";
import type { OutboxAction } from "@/lib/outbox-types";

// Batch flush endpoint for the offline outbox (lib/outbox.ts). A curator who
// worked a whole shift underground reconnects with up to 20 pending actions
// — this is 1 request at reconnect, not 20, and results are per-action so
// one poison record can't wedge the rest of the batch (see queue-store.ts).
export async function POST(request: Request) {
  const session = await requireCuratorSession();
  if (session instanceof NextResponse) return session;

  const body = (await request.json().catch(() => null)) as { actions?: OutboxAction[] } | null;
  if (!body || !Array.isArray(body.actions)) {
    return NextResponse.json({ error: "expected { actions: OutboxAction[] }" }, { status: 400 });
  }

  const results = await queueStore.applyActions(session.curatorId, body.actions);
  return NextResponse.json({ results });
}
