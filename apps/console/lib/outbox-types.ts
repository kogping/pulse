// Shared shape between the client outbox (lib/outbox*.ts) and the server
// write path (lib/queue-store.ts, app/api/queue/verify). One flat action
// type for all three kinds keeps the client -> IndexedDB -> POST path and
// the server's per-action dedupe/apply loop working off the same contract.
export type OutboxActionKind = "confirm" | "correct" | "revert";

export interface OutboxAction {
  // Client-generated (crypto.randomUUID(), see lib/outbox-idb.ts). Doubles
  // as verification_events.client_action_id — the server's idempotency key.
  id: string;
  // Monotonic, issued from the IndexedDB "meta" store in the same
  // transaction as the put, so two rapid taps can't collide. Flush order.
  seq: number;
  kind: OutboxActionKind;
  venueAttributeId: string;
  // The new value for 'correct'; the value to restore for 'revert';
  // unused (null) for 'confirm', which doesn't change the value.
  value: string | null;
  // Snapshot of what venue_attributes held right before this action, so a
  // later 'revert' can restore both the value AND last_verified_at —
  // restoring only the value would leave confidence reading "fresh" against
  // a bumped timestamp (freshness is derived from last_verified_at, never
  // stored — see packages/db/src/freshness.ts).
  previousValue: string;
  previousVerifiedAt: string; // ISO
  // 'revert' only: the action id being undone. Informational for the audit
  // trail — the server does not need to look the original row up to apply
  // the revert, since previousValue/previousVerifiedAt are already here.
  targetActionId?: string;
  // Client-measured item-shown -> submit time in ms. Absent on reverts.
  durationMs?: number;
  createdAt: number;
  // Sent-eligibility gate for the 5s undo window — the flusher only ever
  // transmits actions whose notBefore has passed. See lib/outbox.ts.
  notBefore: number;
}

export type OutboxActionResultStatus = "applied" | "duplicate" | "rejected";

export interface OutboxActionResult {
  id: string;
  status: OutboxActionResultStatus;
  reason?: string;
}
