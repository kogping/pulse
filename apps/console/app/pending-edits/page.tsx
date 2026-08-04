import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { queueStore } from "@/lib/queue-store";
import { PendingEditsList } from "./pending-edits-list";

// Auth-gated the same as /queue and /ops — any signed-in curator can see
// and act on this list. The COI guarantee (an author can't approve their
// own edit) lives server-side in decidePendingEdit, not in who can load
// this page.
export default async function PendingEditsPage() {
  const session = await auth();
  if (!session) redirect("/signin");

  const edits = await queueStore.listPendingEdits("pending");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8 text-ink-50">
      <header>
        <h1 className="text-xl font-semibold">Pending edits</h1>
        <p className="text-sm text-ink-300">
          Corrections made by a curator with a declared conflict of interest in the venue. Approve or reject as a second curator.
        </p>
      </header>
      <PendingEditsList edits={edits} />
    </main>
  );
}
