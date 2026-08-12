import { NextResponse } from "next/server";
import { requireCuratorSession } from "@/lib/auth";
import { submitAuditVerdict } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireCuratorSession();
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { verdict?: "correct" | "incorrect" } | null;
  if (body?.verdict !== "correct" && body?.verdict !== "incorrect") {
    return NextResponse.json({ error: "expected { verdict: 'correct' | 'incorrect' }" }, { status: 400 });
  }

  const applied = await submitAuditVerdict(id, body.verdict, session.curatorId);
  if (!applied) return NextResponse.json({ error: "not found or already reviewed" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
