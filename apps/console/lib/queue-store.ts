import { randomUUID } from "node:crypto";
import { ATTRIBUTE_REGISTRY, attributeConfidence, type QueueItem, type ResolvedVenueAttribute } from "@pulse/db";
import { globalSingleton } from "./global-store";
import type { OutboxAction, OutboxActionResult } from "./outbox-types";

export type PendingEditStatus = "pending" | "approved" | "rejected";

export interface PendingEditSummary {
  id: string;
  venueAttributeId: string;
  venueId: string;
  curatorId: string;
  previousValue: string;
  newValue: string;
  status: PendingEditStatus;
  createdAt: Date;
}

export type DecidePendingEditResult = "not_found" | "already_decided" | "self_approval" | "applied" | "rejected";

// Storage abstraction for the verification queue — same rationale as
// venue-store.ts/curator-store.ts: production goes through Drizzle/Neon,
// vitest and Playwright run against an in-memory store under AUTH_TEST_MODE
// so neither needs a live database. Unlike those stores, the Drizzle branch
// below still dynamic-imports the driver-touching pieces (db, schema
// tables), so AUTH_TEST_MODE runs never load @neondatabase/serverless.
//
// Also owns conflict-of-interest enforcement (F0.3): declared interests
// (declareInterest) keep a venue out of that curator's own queue
// (nextBatch), and any 'correct' action against a venue the curator has
// declared an interest in is parked in pending_edits (applyActions) rather
// than applied to venue_attributes — decidePendingEdit is the only path
// that can move it from there into venue_attributes, and it refuses to let
// the declaring curator be the one who approves it.
export interface QueueStore {
  nextBatch(curatorId: string, size: number): Promise<QueueItem[]>;
  applyActions(curatorId: string, actions: OutboxAction[]): Promise<OutboxActionResult[]>;
  declareInterest(curatorId: string, venueId: string, nature: string): Promise<void>;
  listPendingEdits(status?: PendingEditStatus): Promise<PendingEditSummary[]>;
  decidePendingEdit(pendingEditId: string, decision: "approve" | "reject", decidingCuratorId: string): Promise<DecidePendingEditResult>;
  // The public read path for a single attribute — deliberately the same
  // discriminated union apps/web would receive, so this doubles as proof
  // that an unapproved pending edit can't leak a value that hasn't been
  // vouched for.
  getPublicAttribute(venueAttributeId: string): Promise<ResolvedVenueAttribute | null>;
}

function createDrizzleQueueStore(): QueueStore {
  return {
    async nextBatch(curatorId, size) {
      const { nextQueueBatch } = await import("@pulse/db");
      return nextQueueBatch(curatorId, size);
    },

    async declareInterest(curatorId, venueId, nature) {
      const { declareInterest } = await import("@pulse/db");
      await declareInterest(curatorId, venueId, nature);
    },

    async listPendingEdits(status = "pending") {
      const { listPendingEdits } = await import("@pulse/db");
      const rows = await listPendingEdits(status);
      return rows.map((row) => ({
        id: row.id,
        venueAttributeId: row.venueAttributeId,
        venueId: row.venueId,
        curatorId: row.curatorId,
        previousValue: row.previousValue,
        newValue: row.newValue,
        status: row.status,
        createdAt: row.createdAt,
      }));
    },

    async decidePendingEdit(pendingEditId, decision, decidingCuratorId) {
      const { decidePendingEdit } = await import("@pulse/db");
      return decidePendingEdit(pendingEditId, decision, decidingCuratorId);
    },

    async getPublicAttribute(venueAttributeId) {
      const { resolvePublicAttribute } = await import("@pulse/db");
      return resolvePublicAttribute(venueAttributeId);
    },

    async applyActions(curatorId, actions) {
      const { db, venueAttributes, verificationEvents, pendingEdits, curatorVenueInterests } = await import("@pulse/db");
      const { eq, inArray, sql } = await import("drizzle-orm");

      const sorted = [...actions].sort((a, b) => a.seq - b.seq);
      const results: OutboxActionResult[] = [];

      // Bulk-fetch what per-action logic below needs, rather than a
      // (select attribute + select hasDeclaredInterest) round trip pair per
      // action — for a full 20-action offline outbox flush this cuts ~40
      // sequential DB round trips down to 2, before the per-action
      // insert/update writes (which do need to run in order; see the catch
      // block below).
      const attributeIds = [...new Set(sorted.map((a) => a.venueAttributeId))];
      const attributeRows =
        attributeIds.length === 0
          ? []
          : await db
              .select({ id: venueAttributes.id, venueId: venueAttributes.venueId })
              .from(venueAttributes)
              .where(inArray(venueAttributes.id, attributeIds));
      const attributeById = new Map(attributeRows.map((row) => [row.id, row]));

      const interestRows = await db
        .select({ venueId: curatorVenueInterests.venueId })
        .from(curatorVenueInterests)
        .where(eq(curatorVenueInterests.curatorId, curatorId));
      const interestedVenueIds = new Set(interestRows.map((row) => row.venueId));

      for (const action of sorted) {
        try {
          const attribute = attributeById.get(action.venueAttributeId);
          if (!attribute) {
            results.push({ id: action.id, status: "rejected", reason: "unknown venue attribute" });
            continue;
          }

          // Only 'correct' actually changes venue_attributes.value — a
          // 'confirm' just re-stamps last_verified_at and a 'revert'
          // restores a prior verified snapshot, neither of which is the
          // kind of unilateral edit COI is guarding against. The queue
          // batch already excludes conflicted venues entirely (queue.ts),
          // so this is the backstop for a stale client-side outbox action
          // queued before the interest was declared.
          if (action.kind === "correct" && interestedVenueIds.has(attribute.venueId)) {
            const inserted = await db
              .insert(pendingEdits)
              .values({
                venueAttributeId: action.venueAttributeId,
                venueId: attribute.venueId,
                curatorId,
                previousValue: action.previousValue,
                newValue: action.value!,
                durationMs: action.durationMs ?? null,
                clientActionId: action.id,
              })
              .onConflictDoNothing({ target: pendingEdits.clientActionId, where: sql`${pendingEdits.clientActionId} is not null` })
              .returning({ id: pendingEdits.id });
            results.push(inserted.length === 0 ? { id: action.id, status: "duplicate" } : { id: action.id, status: "pending_review" });
            continue;
          }

          const inserted = await db
            .insert(verificationEvents)
            .values({
              venueAttributeId: action.venueAttributeId,
              curatorId,
              action: action.kind,
              previousValue: action.kind === "correct" ? action.previousValue : null,
              newValue: action.kind === "correct" ? action.value : action.kind === "revert" ? action.previousValue : null,
              durationMs: action.durationMs ?? null,
              clientActionId: action.id,
            })
            .onConflictDoNothing({
              target: verificationEvents.clientActionId,
              where: sql`${verificationEvents.clientActionId} is not null`,
            })
            .returning({ id: verificationEvents.id });

          if (inserted.length === 0) {
            results.push({ id: action.id, status: "duplicate" });
            continue;
          }

          if (action.kind === "revert") {
            // Restore BOTH value and last_verified_at from the snapshot —
            // see the comment on OutboxAction.previousVerifiedAt.
            await db
              .update(venueAttributes)
              .set({ value: action.previousValue, lastVerifiedAt: new Date(action.previousVerifiedAt), verifiedBy: curatorId })
              .where(eq(venueAttributes.id, action.venueAttributeId));
          } else if (action.kind === "correct") {
            await db
              .update(venueAttributes)
              .set({ value: action.value!, lastVerifiedAt: new Date(), verifiedBy: curatorId })
              .where(eq(venueAttributes.id, action.venueAttributeId));
          } else {
            await db
              .update(venueAttributes)
              .set({ lastVerifiedAt: new Date(), verifiedBy: curatorId })
              .where(eq(venueAttributes.id, action.venueAttributeId));
          }

          results.push({ id: action.id, status: "applied" });
        } catch (error) {
          // Logged so a non-transient failure (bad payload, schema drift)
          // is diagnosable server-side instead of surfacing to the curator
          // only as an indefinitely-retried "transient" outbox entry.
          console.error(`[queue-store] applyActions failed on action ${action.id} (${action.kind})`, error);
          // Stop here rather than continuing past the gap — actions after
          // this one in `sorted` depend on FIFO ordering being preserved,
          // and applying them out of order would violate that guarantee.
          // The client keeps unresolved actions in its outbox and retries.
          results.push({ id: action.id, status: "rejected", reason: "transient" });
          break;
        }
      }

      return results;
    },
  };
}

interface InMemoryVenueAttribute {
  id: string;
  venueId: string;
  venueName: string;
  attributeKey: string;
  label: string;
  inputType: "select" | "text" | "boolean" | "time";
  options?: readonly string[];
  value: string;
  lastVerifiedAt: Date;
  flagCount: number;
}

interface InMemoryPendingEdit {
  id: string;
  venueAttributeId: string;
  venueId: string;
  curatorId: string;
  previousValue: string;
  newValue: string;
  status: PendingEditStatus;
  createdAt: Date;
}

export interface AppliedRecord {
  clientActionId: string;
  venueAttributeId: string;
  kind: string;
  value: string | null;
  at: string;
}

function testAttributes() {
  return globalSingleton("test-queue-attributes", () => new Map<string, InMemoryVenueAttribute>());
}
function testAppliedActionIds() {
  return globalSingleton("test-queue-applied-ids", () => new Set<string>());
}
function testAppliedLog() {
  return globalSingleton("test-queue-applied-log", () => [] as AppliedRecord[]);
}
// Keyed `${curatorId}:${venueId}` — a Set is enough, "nature" isn't needed
// by any enforcement check, only by the (unimplemented in-memory) audit view.
function testInterests() {
  return globalSingleton("test-curator-venue-interests", () => new Set<string>());
}
function testPendingEdits() {
  return globalSingleton("test-pending-edits", () => new Map<string, InMemoryPendingEdit>());
}

function createInMemoryQueueStore(): QueueStore {
  return {
    async nextBatch(curatorId, size) {
      const now = new Date();
      const interests = testInterests();
      return [...testAttributes().values()]
        .filter((a) => !interests.has(`${curatorId}:${a.venueId}`))
        .sort((a, b) => {
          if (a.flagCount > 0 !== b.flagCount > 0) return a.flagCount > 0 ? -1 : 1;
          return a.lastVerifiedAt.getTime() - b.lastVerifiedAt.getTime();
        })
        .slice(0, size)
        .map(
          (a): QueueItem => ({
            id: a.id,
            venueId: a.venueId,
            venueName: a.venueName,
            attributeKey: a.attributeKey,
            label: a.label,
            inputType: a.inputType,
            options: a.options,
            flagged: a.flagCount > 0,
            current: {
              value: a.value,
              lastVerifiedAt: a.lastVerifiedAt,
              confidence: attributeConfidence({
                attributeKey: a.attributeKey,
                lastVerifiedAt: a.lastVerifiedAt,
                flagCount: a.flagCount,
                now,
              }),
            },
          }),
        );
    },

    async declareInterest(curatorId, venueId) {
      testInterests().add(`${curatorId}:${venueId}`);
    },

    async listPendingEdits(status = "pending") {
      return [...testPendingEdits().values()].filter((e) => e.status === status);
    },

    async decidePendingEdit(pendingEditId, decision, decidingCuratorId) {
      const edit = testPendingEdits().get(pendingEditId);
      if (!edit) return "not_found";
      if (edit.status !== "pending") return "already_decided";
      if (edit.curatorId === decidingCuratorId) return "self_approval";

      if (decision === "reject") {
        edit.status = "rejected";
        return "rejected";
      }

      const record = testAttributes().get(edit.venueAttributeId);
      if (record) {
        record.value = edit.newValue;
        record.lastVerifiedAt = new Date();
      }
      edit.status = "approved";
      testAppliedLog().push({
        clientActionId: edit.id,
        venueAttributeId: edit.venueAttributeId,
        kind: "correct",
        value: edit.newValue,
        at: new Date().toISOString(),
      });
      return "applied";
    },

    async getPublicAttribute(venueAttributeId) {
      const record = testAttributes().get(venueAttributeId);
      if (!record) return null;
      const confidence = attributeConfidence({
        attributeKey: record.attributeKey,
        lastVerifiedAt: record.lastVerifiedAt,
        flagCount: record.flagCount,
        now: new Date(),
      });
      if (confidence === "unconfirmed") return { confidence };
      return { confidence, value: record.value, lastVerifiedAt: record.lastVerifiedAt };
    },

    async applyActions(curatorId, actions) {
      const attributes = testAttributes();
      const appliedActionIds = testAppliedActionIds();
      const applied = testAppliedLog();
      const interests = testInterests();
      const pending = testPendingEdits();
      const sorted = [...actions].sort((a, b) => a.seq - b.seq);
      const results: OutboxActionResult[] = [];

      for (const action of sorted) {
        const record = attributes.get(action.venueAttributeId);
        if (!record) {
          results.push({ id: action.id, status: "rejected", reason: "unknown venue attribute" });
          continue;
        }
        if (appliedActionIds.has(action.id)) {
          results.push({ id: action.id, status: "duplicate" });
          continue;
        }

        if (action.kind === "correct" && interests.has(`${curatorId}:${record.venueId}`)) {
          const id = randomUUID();
          pending.set(id, {
            id,
            venueAttributeId: action.venueAttributeId,
            venueId: record.venueId,
            curatorId,
            previousValue: action.previousValue,
            newValue: action.value!,
            status: "pending",
            createdAt: new Date(),
          });
          appliedActionIds.add(action.id);
          results.push({ id: action.id, status: "pending_review" });
          continue;
        }

        if (action.kind === "revert") {
          record.value = action.previousValue;
          record.lastVerifiedAt = new Date(action.previousVerifiedAt);
        } else if (action.kind === "correct") {
          record.value = action.value!;
          record.lastVerifiedAt = new Date();
        } else {
          record.lastVerifiedAt = new Date();
        }

        appliedActionIds.add(action.id);
        applied.push({
          clientActionId: action.id,
          venueAttributeId: action.venueAttributeId,
          kind: action.kind,
          value: action.kind === "confirm" ? null : action.value,
          at: new Date().toISOString(),
        });
        results.push({ id: action.id, status: "applied" });
      }

      return results;
    },
  };
}

export const queueStore: QueueStore =
  process.env.AUTH_TEST_MODE === "1" ? createInMemoryQueueStore() : createDrizzleQueueStore();

// --- test-only helpers, mirroring getInbox() in lib/email.ts ---

// Registry-derived seed value per input type, so every seeded item starts in
// a valid state for its own control. ATTRIBUTE_REGISTRY has exactly 10
// entries (3 select, 3 text, 3 boolean, 1 time); seeding 2 venues' worth (20
// items) covers all four input types, which e2e/queue.spec.ts asserts on.
const REGISTRY_SEED_VALUES = ATTRIBUTE_REGISTRY.map((entry) => ({
  ...entry,
  seedValue: entry.options?.[0] ?? (entry.inputType === "boolean" ? "yes" : entry.inputType === "time" ? "18:00" : "Not yet set"),
}));

export function seedTestQueue(size = 20): QueueItem[] {
  const attributes = testAttributes();
  testAppliedActionIds().clear();
  testAppliedLog().length = 0;
  testInterests().clear();
  testPendingEdits().clear();
  attributes.clear();

  const items: QueueItem[] = [];
  for (let i = 0; i < size; i++) {
    const entry = REGISTRY_SEED_VALUES[i % REGISTRY_SEED_VALUES.length]!;
    const venueIndex = Math.floor(i / REGISTRY_SEED_VALUES.length);
    const id = `qi-${String(i).padStart(2, "0")}`;
    // Strictly increasing staleness so ordering assertions have a clear signal.
    const lastVerifiedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    attributes.set(id, {
      id,
      venueId: `venue-${venueIndex}`,
      venueName: `Test Venue ${venueIndex}`,
      attributeKey: entry.key,
      label: entry.label,
      inputType: entry.inputType,
      options: entry.options,
      value: entry.seedValue,
      lastVerifiedAt,
      flagCount: 0,
    });
    items.push({
      id,
      venueId: `venue-${venueIndex}`,
      venueName: `Test Venue ${venueIndex}`,
      attributeKey: entry.key,
      label: entry.label,
      inputType: entry.inputType,
      options: entry.options,
      flagged: false,
      current: { value: entry.seedValue, lastVerifiedAt, confidence: "ageing" },
    });
  }
  return items;
}

export function getTestQueueState(): { applied: AppliedRecord[] } {
  return { applied: [...testAppliedLog()] };
}

// Test-only: seedTestQueue backdates every item so staleness-ordering
// assertions have a clear signal, which also makes them 'unconfirmed' by
// the time a same-day COI test reads them back (freshness decays in well
// under the months of gap between the fixed seed date and "now"). Lets a
// test put a specific item back within its fresh/ageing window so the
// public read path assertions have a value to compare, not just a
// confidence tier.
export function setTestAttributeVerifiedAt(id: string, at: Date): void {
  const record = testAttributes().get(id);
  if (record) record.lastVerifiedAt = at;
}
