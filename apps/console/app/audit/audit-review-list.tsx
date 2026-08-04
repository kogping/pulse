"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingAuditItem } from "@/lib/audit";

// Correct/incorrect review UI for the nightly audit sample (§9). Each
// verdict is one POST to /api/audit/[id]; the server refuses a second
// verdict against an already-reviewed sample (recordAuditVerdict), so a
// double-click here just no-ops rather than double-counting.
export function AuditReviewList({ items }: { items: PendingAuditItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function review(id: string, verdict: "correct" | "incorrect") {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/audit/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      router.refresh();
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-ink-300">No samples are waiting on review.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.auditSampleId} className="flex flex-col gap-2 rounded border border-ink-700 p-3 text-sm">
            <div className="font-medium">{item.venueName}</div>
            <div className="text-ink-300">
              {item.attributeKey}: <span className="text-ink-50">{item.value}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => review(item.auditSampleId, "correct")}
                className="rounded bg-ink-50 px-3 py-1 text-ink-950 disabled:opacity-50"
              >
                Correct
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => review(item.auditSampleId, "incorrect")}
                className="rounded border border-ink-700 px-3 py-1 disabled:opacity-50"
              >
                Incorrect
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
