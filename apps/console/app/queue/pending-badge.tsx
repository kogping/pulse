"use client";

import { useSyncExternalStore } from "react";
import { getOutboxServerSnapshot, getOutboxSnapshot, subscribeOutbox } from "@/lib/outbox";

// aria-live rather than role="status" — the undo toast already uses
// role="status", and Playwright's page.getByRole("status") must resolve to
// exactly one element while the toast is visible.
export function PendingBadge() {
  const snapshot = useSyncExternalStore(subscribeOutbox, getOutboxSnapshot, getOutboxServerSnapshot);
  return (
    <span aria-live="polite" className="flex items-center gap-1 text-xs text-ink-300">
      <span data-testid="pending-count">{snapshot.pending}</span>
      <span>pending{snapshot.blocked === "auth" ? " · sign in to sync" : ""}</span>
    </span>
  );
}
