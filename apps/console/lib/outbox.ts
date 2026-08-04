// The offline outbox's public API: enqueue confirm/correct actions,
// undo within the 5s grace window, and a flusher that sends eligible
// actions to /api/queue/verify whenever the app comes back online. See
// docs on OutboxAction (outbox-types.ts) and the eligibility/backoff rules
// in outbox-policy.ts for the reasoning; this file wires those to real
// IndexedDB (outbox-idb.ts) and a real fetch.
import { countActions, deleteActions, enqueueAction, getAction, getAllActions, isIndexedDbAvailable } from "./outbox-idb";
import { idsToRemove, nextBackoff, selectEligible } from "./outbox-policy";
import type { OutboxActionKind, OutboxActionResult } from "./outbox-types";

const UNDO_WINDOW_MS = 5_000;

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for non-secure-context LAN testing on a real phone, where
  // crypto.randomUUID() is unavailable.
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// --- snapshot, for useSyncExternalStore in the UI (see app/queue/pending-badge.tsx) ---

export interface OutboxSnapshot {
  pending: number;
  syncing: boolean;
  blocked: "auth" | null;
}

// Module-level constant: useSyncExternalStore compares the server snapshot
// by reference, so a freshly-allocated object on every call is an infinite
// render loop.
const SERVER_SNAPSHOT: OutboxSnapshot = { pending: 0, syncing: false, blocked: null };

let snapshot: OutboxSnapshot = { ...SERVER_SNAPSHOT };
const listeners = new Set<() => void>();

export function subscribeOutbox(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
export function getOutboxSnapshot(): OutboxSnapshot {
  return snapshot;
}
export function getOutboxServerSnapshot(): OutboxSnapshot {
  return SERVER_SNAPSHOT;
}

async function publish(patch: Partial<OutboxSnapshot>): Promise<void> {
  // Recomputed from IndexedDB's count() rather than incremented/decremented
  // locally — an increment/decrement drifts the moment a flush partially
  // fails.
  const pending = isIndexedDbAvailable() ? await countActions() : 0;
  snapshot = { ...snapshot, ...patch, pending };
  for (const callback of listeners) callback();
}

// --- enqueue / undo ---

interface EnqueueInput {
  kind: OutboxActionKind;
  venueAttributeId: string;
  value: string | null;
  previousValue: string;
  previousVerifiedAt: string;
  targetActionId?: string;
  durationMs?: number;
  notBefore?: number;
}

async function enqueue(input: EnqueueInput): Promise<string> {
  const id = generateId();
  const createdAt = Date.now();
  const action = await enqueueAction({
    id,
    kind: input.kind,
    venueAttributeId: input.venueAttributeId,
    value: input.value,
    previousValue: input.previousValue,
    previousVerifiedAt: input.previousVerifiedAt,
    targetActionId: input.targetActionId,
    durationMs: input.durationMs,
    createdAt,
    notBefore: input.notBefore ?? createdAt + UNDO_WINDOW_MS,
  });
  await publish({});
  scheduleFlush();
  return action.id;
}

export function enqueueConfirm(input: {
  venueAttributeId: string;
  previousValue: string;
  previousVerifiedAt: string;
  durationMs?: number;
}): Promise<string> {
  return enqueue({ ...input, kind: "confirm", value: null });
}

export function enqueueCorrect(input: {
  venueAttributeId: string;
  value: string;
  previousValue: string;
  previousVerifiedAt: string;
  durationMs?: number;
}): Promise<string> {
  return enqueue({ ...input, kind: "correct" });
}

// Ids currently inside an in-flight POST to /api/queue/verify. Undo checks
// this first: normally an action can't be sent before its 5s notBefore has
// passed, and the UI retires the Undo affordance at 5s too, so the two
// windows shouldn't overlap — but a forced/manual flush (tests; a very late
// boot-flush) could race them. If the id is inflight, we don't know whether
// the server has it yet, so undo enqueues a compensating revert instead of
// deleting.
const inflightIds = new Set<string>();

export async function undo(id: string): Promise<"cancelled" | "reverting"> {
  if (!inflightIds.has(id)) {
    await deleteActions([id]);
    await publish({});
    return "cancelled";
  }
  const original = await getAction(id);
  if (!original) return "cancelled";
  await enqueue({
    kind: "revert",
    venueAttributeId: original.venueAttributeId,
    value: original.previousValue,
    previousValue: original.previousValue,
    previousVerifiedAt: original.previousVerifiedAt,
    targetActionId: id,
    notBefore: 0, // no grace window on a revert — it's already a correction
  });
  return "reverting";
}

// --- flush ---

let inFlight: Promise<void> | null = null;
let rerunRequested = false;
let failureStreak = 0;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;

function clearBackoffTimer(): void {
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

function armBackoffTimer(delayMs: number): void {
  if (backoffTimer !== null) return;
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    void flush();
  }, delayMs);
}

export function scheduleFlush(): void {
  void flush();
  armBackoffTimer(nextBackoff(0));
}

function reportBreadcrumb(error: unknown): void {
  if (typeof window === "undefined") return;
  import("@sentry/nextjs")
    .then(({ addBreadcrumb }) =>
      addBreadcrumb({ category: "outbox", message: "flush failed, will retry", level: "warning", data: { error: String(error) } }),
    )
    .catch(() => {
      // Sentry itself failing to load must never break the flush loop.
    });
}

async function drain(): Promise<void> {
  const all = await getAllActions();
  const eligible = selectEligible(all, Date.now());

  if (eligible.length > 0) {
    await publish({ syncing: true });
    for (const action of eligible) inflightIds.add(action.id);

    try {
      const response = await fetch("/api/queue/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actions: eligible }),
      });

      if (response.status === 401) {
        // A long offline stretch can outlive the session. Pause rather than
        // burn through attempts against a signed-out server — and never
        // delete: these are real verifications waiting to sync.
        await publish({ syncing: false, blocked: "auth" });
        for (const action of eligible) inflightIds.delete(action.id);
        return;
      }
      if (!response.ok) throw new Error(`flush failed with status ${response.status}`);

      const body = (await response.json()) as { results: OutboxActionResult[] };
      await deleteActions(idsToRemove(body.results));
      failureStreak = 0;
      await publish({ syncing: false, blocked: null });
    } catch (error) {
      failureStreak += 1;
      reportBreadcrumb(error);
      await publish({ syncing: false });
    } finally {
      for (const action of eligible) inflightIds.delete(action.id);
    }
  }

  const remaining = await countActions();
  if (remaining > 0) {
    armBackoffTimer(nextBackoff(failureStreak));
  } else {
    clearBackoffTimer();
    failureStreak = 0;
  }
}

async function doFlush(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    await locks.request("pulse-outbox-flush", { ifAvailable: true }, async (lock) => {
      if (lock) await drain();
    });
  } else {
    await drain();
  }
}

export function flush(): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = doFlush().finally(() => {
    inFlight = null;
    if (rerunRequested) {
      rerunRequested = false;
      void flush();
    }
  });
  return inFlight;
}

// --- lifecycle triggers ---

let listenersAttached = false;

// Called once from the queue page on mount. Boot flush recovers a tab that
// was closed mid-offline-window; `online`/visibilitychange cover reconnect
// (visibilitychange because `online` is unreliable on backgrounded mobile
// tabs, which is exactly the scenario this exists for).
export function attachOutboxListeners(): () => void {
  if (typeof window === "undefined" || listenersAttached) return () => {};
  listenersAttached = true;

  const onOnline = () => void flush();
  const onVisibility = () => {
    if (document.visibilityState === "visible") void flush();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  void flush();

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    listenersAttached = false;
  };
}

// Test-only debug hook so Playwright can force concurrent flushes to assert
// the single-flight/lock guards actually prevent double-submission (see
// e2e/queue-offline.spec.ts). Harmless in production — it only ever
// triggers the same flush the UI triggers itself on reconnect.
if (typeof window !== "undefined") {
  (window as unknown as { __pulseOutbox?: unknown }).__pulseOutbox = { flush, getSnapshot: getOutboxSnapshot };
}
