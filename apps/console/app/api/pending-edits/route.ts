import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";

// Any signed-in curator can see the pending-review queue — approve/reject
// is gated in decidePendingEdit (the author can never be the approver),
// not by hiding the list from anyone.
export async function GET() {
  const session = await auth();
  if (!session?.curatorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const edits = await queueStore.listPendingEdits("pending");
  return NextResponse.json({ edits });
}
