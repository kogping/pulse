"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingEditSummary } from "@/lib/queue-store";

// Approve/reject UI for edits parked by conflict-of-interest curators
// (F0.3). Deliberately no self-service path here: the server refuses a
// decision from the curator who authored the edit (decidePendingEdit), so
// this component doesn't try to hide the row from its own author client-side
// — the API is the enforcement point, this is just the UI for it.
export function PendingEditsList({ edits }: { edits: PendingEditSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(id: string, decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/pending-edits/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      router.refresh();
    });
  }

  if (edits.length === 0) {
    return <p className="text-sm text-ink-300">No edits are waiting on review.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {edits.map((edit) => (
          <li key={edit.id} className="flex flex-col gap-2 rounded border border-ink-700 p-3 text-sm">
            <div>
              <span className="text-ink-300">was</span> {edit.previousValue} <span className="text-ink-300">→ now</span> {edit.newValue}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => decide(edit.id, "approve")}
                className="rounded bg-ink-50 px-3 py-1 text-ink-950 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => decide(edit.id, "reject")}
                className="rounded border border-ink-700 px-3 py-1 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
