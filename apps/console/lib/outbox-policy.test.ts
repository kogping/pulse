import { describe, expect, it } from "vitest";
import { hasExceededMaxAttempts, idsToRemove, nextBackoff, orderBySeq, selectEligible } from "./outbox-policy";
import type { OutboxAction, OutboxActionResult } from "./outbox-types";

function action(overrides: Partial<OutboxAction> & { id: string; seq: number }): OutboxAction {
  return {
    kind: "confirm",
    venueAttributeId: "attr-1",
    value: null,
    previousValue: "none",
    previousVerifiedAt: new Date(0).toISOString(),
    createdAt: 0,
    notBefore: 0,
    ...overrides,
  };
}

describe("orderBySeq", () => {
  it("sorts ascending by seq without mutating the input", () => {
    const input = [action({ id: "b", seq: 2 }), action({ id: "a", seq: 1 })];
    const sorted = orderBySeq(input);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b"]);
    expect(input.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("selectEligible", () => {
  it("excludes records still inside their undo grace window", () => {
    const now = 10_000;
    const records = [
      action({ id: "past", seq: 1, notBefore: 9_999 }),
      action({ id: "future", seq: 2, notBefore: 10_001 }),
      action({ id: "exact", seq: 3, notBefore: 10_000 }),
    ];
    expect(selectEligible(records, now).map((a) => a.id)).toEqual(["past", "exact"]);
  });

  it("returns eligible records in seq order regardless of input order", () => {
    const now = 100;
    const records = [action({ id: "second", seq: 2, notBefore: 0 }), action({ id: "first", seq: 1, notBefore: 0 })];
    expect(selectEligible(records, now).map((a) => a.id)).toEqual(["first", "second"]);
  });
});

describe("nextBackoff", () => {
  it("follows the 2s -> 5s -> 15s -> 60s schedule and caps at 60s", () => {
    expect(nextBackoff(0)).toBe(2_000);
    expect(nextBackoff(1)).toBe(5_000);
    expect(nextBackoff(2)).toBe(15_000);
    expect(nextBackoff(3)).toBe(60_000);
    expect(nextBackoff(100)).toBe(60_000);
  });

  it("clamps negative attempts to the first tier", () => {
    expect(nextBackoff(-1)).toBe(2_000);
  });
});

describe("hasExceededMaxAttempts", () => {
  it("is false below the cap and true at/above it", () => {
    expect(hasExceededMaxAttempts(7)).toBe(false);
    expect(hasExceededMaxAttempts(8)).toBe(true);
  });
});

describe("idsToRemove", () => {
  it("removes applied, duplicate, and rejected results, keeping nothing else", () => {
    const results: OutboxActionResult[] = [
      { id: "a", status: "applied" },
      { id: "b", status: "duplicate" },
      { id: "c", status: "rejected", reason: "unknown venue attribute" },
    ];
    expect(idsToRemove(results).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty result set (e.g. a request-level failure)", () => {
    expect(idsToRemove([])).toEqual([]);
  });
});
