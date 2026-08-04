// Pure decision logic for the offline outbox, split out from
// outbox-idb.ts/outbox.ts so it's covered by fast node-environment vitest —
// console's vitest has no jsdom, so IndexedDB itself can only be exercised
// by Playwright (see e2e/queue-offline.spec.ts). This is where the ordering
// and retry bugs would live, so it's the half worth unit-testing.
import type { OutboxAction, OutboxActionResult } from "./outbox-types";

export function orderBySeq(records: OutboxAction[]): OutboxAction[] {
  return [...records].sort((a, b) => a.seq - b.seq);
}

// Only records whose undo grace window has passed are eligible to send,
// in FIFO order. See OutboxAction.notBefore.
export function selectEligible(records: OutboxAction[], now: number): OutboxAction[] {
  return orderBySeq(records.filter((r) => r.notBefore <= now));
}

const BACKOFF_SCHEDULE_MS = [2_000, 5_000, 15_000, 60_000] as const;

// 2s -> 5s -> 15s -> 60s, capped. `attempts` is the number of consecutive
// flush failures (not per-action retries — one client, one backoff clock).
export function nextBackoff(attempts: number): number {
  const index = Math.min(Math.max(attempts, 0), BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[index]!;
}

export const MAX_FLUSH_ATTEMPTS = 8;

export function hasExceededMaxAttempts(attempts: number): boolean {
  return attempts >= MAX_FLUSH_ATTEMPTS;
}

// applied/duplicate/rejected/pending_review are all terminal from the
// client's point of view: applied and duplicate both mean the server has
// the verification recorded, rejected (e.g. an unknown venue_attribute_id)
// can never succeed on retry, and pending_review means the server has it
// safely parked in pending_edits awaiting a second curator. Only a missing
// result (request-level failure, so no results array at all) leaves a
// record pending.
const TERMINAL_STATUSES: ReadonlySet<OutboxActionResult["status"]> = new Set([
  "applied",
  "duplicate",
  "rejected",
  "pending_review",
]);

export function idsToRemove(results: OutboxActionResult[]): string[] {
  return results.filter((r) => TERMINAL_STATUSES.has(r.status)).map((r) => r.id);
}
