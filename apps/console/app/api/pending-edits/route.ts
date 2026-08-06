import { NextResponse } from "next/server";
import { requireCuratorSession } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";

// Any signed-in curator can see the pending-review queue — approve/reject
// is gated in decidePendingEdit (the author can never be the approver),
// not by hiding the list from anyone.
export async function GET() {
  const session = await requireCuratorSession();
  if (session instanceof NextResponse) return session;

  const edits = await queueStore.listPendingEdits("pending");
  return NextResponse.json({ edits });
}
