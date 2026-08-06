import { NextResponse } from "next/server";
import { requireCuratorSession } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireCuratorSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { decision?: "approve" | "reject" } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return NextResponse.json({ error: "expected { decision: 'approve' | 'reject' }" }, { status: 400 });
  }

  const result = await queueStore.decidePendingEdit(id, body.decision, session.curatorId);
  if (result === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "already_decided") return NextResponse.json({ error: "already decided" }, { status: 409 });
  if (result === "self_approval") {
    return NextResponse.json({ error: "the curator who made this edit cannot approve or reject it" }, { status: 403 });
  }
  return NextResponse.json({ result });
}
