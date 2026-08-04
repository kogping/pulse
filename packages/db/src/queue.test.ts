import { describe, expect, it } from "vitest";
import { buildQueueItems, type QueueCandidateRow } from "./queue";

const NOW = new Date("2026-08-04T20:00:00Z");

function row(overrides: Partial<QueueCandidateRow> & { id: string }): QueueCandidateRow {
  return {
    venueId: "venue-1",
    venueName: "Test Venue",
    attributeKey: "queue_length",
    value: "none",
    lastVerifiedAt: NOW,
    flagCount: 0,
    ...overrides,
  };
}

describe("buildQueueItems", () => {
  it("drops rows for attribute keys outside the registry", () => {
    const items = buildQueueItems(
      [row({ id: "a", attributeKey: "not_a_real_attribute" }), row({ id: "b", attributeKey: "queue_length" })],
      20,
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(["b"]);
  });

  it("orders flagged items before unflagged, regardless of staleness", () => {
    const items = buildQueueItems(
      [
        row({ id: "stale-unflagged", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 900) }),
        row({ id: "fresh-flagged", lastVerifiedAt: NOW, flagCount: 1 }),
      ],
      20,
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(["fresh-flagged", "stale-unflagged"]);
    expect(items[0]!.flagged).toBe(true);
    expect(items[1]!.flagged).toBe(false);
  });

  it("orders within each flagged bucket by oldest last_verified_at first", () => {
    const items = buildQueueItems(
      [
        row({ id: "newer", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 10) }),
        row({ id: "older", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 5) }),
      ],
      20,
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(["older", "newer"]);
  });

  it("respects the size limit after sorting", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `item-${i}`, lastVerifiedAt: new Date(NOW.getTime() - i * 1000 * 60) }),
    );
    const items = buildQueueItems(rows, 2, NOW);
    expect(items).toHaveLength(2);
    // The two oldest (highest index -> earliest lastVerifiedAt) should win.
    expect(items.map((i) => i.id)).toEqual(["item-4", "item-3"]);
  });

  it("always includes the current value, even when confidence resolves to unconfirmed", () => {
    const items = buildQueueItems(
      [row({ id: "long-stale", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 900), value: "long (20+ min)" })],
      20,
      NOW,
    );
    expect(items[0]!.current).toEqual({
      value: "long (20+ min)",
      lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 900),
      confidence: "unconfirmed",
    });
  });

  it("populates label/inputType/options from the attribute registry", () => {
    const items = buildQueueItems([row({ id: "a", attributeKey: "price_tier" })], 20, NOW);
    expect(items[0]!.label).toBe("Price tier");
    expect(items[0]!.inputType).toBe("select");
    expect(items[0]!.options).toEqual(["$", "$$", "$$$"]);
  });
});
