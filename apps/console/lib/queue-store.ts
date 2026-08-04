import { ATTRIBUTE_REGISTRY, attributeConfidence, type QueueItem } from "@pulse/db";
import { globalSingleton } from "./global-store";
import type { OutboxAction, OutboxActionResult } from "./outbox-types";

// Storage abstraction for the verification queue — same rationale as
// venue-store.ts/curator-store.ts: production goes through Drizzle/Neon,
// vitest and Playwright run against an in-memory store under AUTH_TEST_MODE
// so neither needs a live database. Unlike those stores, the Drizzle branch
// below still dynamic-imports the driver-touching pieces (db, schema
// tables), so AUTH_TEST_MODE runs never load @neondatabase/serverless.
export interface QueueStore {
  nextBatch(curatorId: string, size: number): Promise<QueueItem[]>;
  applyActions(curatorId: string, actions: OutboxAction[]): Promise<OutboxActionResult[]>;
}

function createDrizzleQueueStore(): QueueStore {
  return {
    async nextBatch(curatorId, size) {
      const { nextQueueBatch } = await import("@pulse/db");
      return nextQueueBatch(curatorId, size);
    },

    async applyActions(curatorId, actions) {
      const { db, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { eq, sql } = await import("drizzle-orm");

      const sorted = [...actions].sort((a, b) => a.seq - b.seq);
      const results: OutboxActionResult[] = [];

      for (const action of sorted) {
        try {
          const [attribute] = await db
            .select({ id: venueAttributes.id })
            .from(venueAttributes)
            .where(eq(venueAttributes.id, action.venueAttributeId))
            .limit(1);
          if (!attribute) {
            results.push({ id: action.id, status: "rejected", reason: "unknown venue attribute" });
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
        } catch {
          // Transient failure (e.g. a dropped connection mid-batch). Stop
          // here rather than continuing past the gap — actions after this
          // one in `sorted` depend on FIFO ordering being preserved, and
          // applying them out of order would violate that guarantee. The
          // client keeps unresolved actions in its outbox and retries.
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

function createInMemoryQueueStore(): QueueStore {
  return {
    async nextBatch(_curatorId, size) {
      const now = new Date();
      return [...testAttributes().values()]
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

    async applyActions(_curatorId, actions) {
      const attributes = testAttributes();
      const appliedActionIds = testAppliedActionIds();
      const applied = testAppliedLog();
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
