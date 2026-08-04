import { beforeEach, describe, expect, it } from "vitest";
import { queueStore, seedTestQueue, setTestAttributeVerifiedAt } from "./queue-store";
import type { OutboxAction } from "./outbox-types";

const CURATOR_A = "curator-a";
const CURATOR_B = "curator-b";
const ATTRIBUTE_ID = "qi-00"; // seedTestQueue's item 0, venueId "venue-0"
const VENUE_ID = "venue-0";

function correctAction(overrides: Partial<OutboxAction> & Pick<OutboxAction, "previousValue" | "value">): OutboxAction {
  return {
    id: `action-${Math.random().toString(36).slice(2)}`,
    seq: 1,
    kind: "correct",
    venueAttributeId: ATTRIBUTE_ID,
    previousVerifiedAt: new Date().toISOString(),
    createdAt: Date.now(),
    notBefore: 0,
    ...overrides,
  };
}

describe("conflict of interest (F0.3)", () => {
  beforeEach(() => {
    seedTestQueue(20);
    // Seeded items are backdated for staleness-ordering tests elsewhere;
    // pull this one back to "now" so it resolves to a value (not
    // 'unconfirmed') and the public-read-path assertions below have
    // something to compare.
    setTestAttributeVerifiedAt(ATTRIBUTE_ID, new Date());
  });

  it("excludes a declared venue from that curator's queue, but not another curator's", async () => {
    const before = await queueStore.nextBatch(CURATOR_A, 20);
    expect(before.some((item) => item.venueId === VENUE_ID)).toBe(true);

    await queueStore.declareInterest(CURATOR_A, VENUE_ID, "friend owns the venue");

    const afterA = await queueStore.nextBatch(CURATOR_A, 20);
    expect(afterA.some((item) => item.venueId === VENUE_ID)).toBe(false);

    const afterB = await queueStore.nextBatch(CURATOR_B, 20);
    expect(afterB.some((item) => item.venueId === VENUE_ID)).toBe(true);
  });

  it("parks a conflicted curator's edit in pending_edits and leaves venue_attributes unchanged", async () => {
    await queueStore.declareInterest(CURATOR_A, VENUE_ID, "friend owns the venue");
    const before = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    expect(before).not.toBeNull();
    if (!before || before.confidence === "unconfirmed") throw new Error("test setup expected a visible pre-edit value");

    const results = await queueStore.applyActions(CURATOR_A, [
      correctAction({ previousValue: before.value, value: "Corrected value" }),
    ]);
    expect(results).toEqual([{ id: expect.any(String), status: "pending_review" }]);

    const pending = await queueStore.listPendingEdits("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      venueAttributeId: ATTRIBUTE_ID,
      venueId: VENUE_ID,
      curatorId: CURATOR_A,
      previousValue: before.value,
      newValue: "Corrected value",
      status: "pending",
    });

    // venue_attributes (via the same read path) is untouched.
    expect(await queueStore.getPublicAttribute(ATTRIBUTE_ID)).toEqual(before);
  });

  it("applies the edit once a second curator approves, and refuses self-approval", async () => {
    await queueStore.declareInterest(CURATOR_A, VENUE_ID, "friend owns the venue");
    const before = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    if (!before || before.confidence === "unconfirmed") throw new Error("test setup expected a visible pre-edit value");

    await queueStore.applyActions(CURATOR_A, [correctAction({ previousValue: before.value, value: "Corrected value" })]);
    const [edit] = await queueStore.listPendingEdits("pending");
    expect(edit).toBeDefined();

    expect(await queueStore.decidePendingEdit(edit!.id, "approve", CURATOR_A)).toBe("self_approval");
    expect(await queueStore.getPublicAttribute(ATTRIBUTE_ID)).toEqual(before);

    expect(await queueStore.decidePendingEdit(edit!.id, "approve", CURATOR_B)).toBe("applied");
    expect(await queueStore.listPendingEdits("pending")).toHaveLength(0);

    const after = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    expect(after && after.confidence !== "unconfirmed" ? after.value : null).toBe("Corrected value");

    // A decided edit can't be decided again.
    expect(await queueStore.decidePendingEdit(edit!.id, "approve", CURATOR_B)).toBe("already_decided");
  });

  it("the public read path returns the pre-edit value for the entire time an edit is pending", async () => {
    await queueStore.declareInterest(CURATOR_A, VENUE_ID, "friend owns the venue");
    const before = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    if (!before || before.confidence === "unconfirmed") throw new Error("test setup expected a visible pre-edit value");

    await queueStore.applyActions(CURATOR_A, [correctAction({ previousValue: before.value, value: "Corrected value" })]);

    // Still pre-edit while unapproved.
    expect(await queueStore.getPublicAttribute(ATTRIBUTE_ID)).toEqual(before);

    const [edit] = await queueStore.listPendingEdits("pending");
    await queueStore.decidePendingEdit(edit!.id, "approve", CURATOR_B);

    const after = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    expect(after).not.toEqual(before);
    expect(after && after.confidence !== "unconfirmed" ? after.value : null).toBe("Corrected value");
  });

  it("does not park a correction from a curator with no declared interest — it applies directly", async () => {
    const before = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    if (!before || before.confidence === "unconfirmed") throw new Error("test setup expected a visible pre-edit value");

    const results = await queueStore.applyActions(CURATOR_B, [correctAction({ previousValue: before.value, value: "Corrected value" })]);
    expect(results).toEqual([{ id: expect.any(String), status: "applied" }]);
    expect(await queueStore.listPendingEdits("pending")).toHaveLength(0);

    const after = await queueStore.getPublicAttribute(ATTRIBUTE_ID);
    expect(after && after.confidence !== "unconfirmed" ? after.value : null).toBe("Corrected value");
  });
});
