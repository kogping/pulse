import { describe, expect, it } from "vitest";
import { pickWeightedSample, type AuditCandidateRow } from "./audit";

const NOW = new Date("2026-08-04T20:00:00Z");

function row(overrides: Partial<AuditCandidateRow> & { id: string }): AuditCandidateRow {
  return {
    venueId: "venue-1",
    venueName: "Test Venue",
    attributeKey: "queue_length",
    lastVerifiedAt: NOW,
    ...overrides,
  };
}

describe("pickWeightedSample", () => {
  it("respects the count limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `item-${i}` }));
    const picked = pickWeightedSample(rows, 3, NOW);
    expect(picked).toHaveLength(3);
  });

  it("returns fewer rows than requested if there aren't enough candidates", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    const picked = pickWeightedSample(rows, 20, NOW);
    expect(picked).toHaveLength(2);
  });

  it("with a constant rng, always favours the stalest row", () => {
    // A constant rng in (0,1) makes key = c ** (1/weight) monotonically
    // increasing in weight (since 0 < c < 1), so the highest-weight (=
    // stalest) row always wins deterministically.
    const rows = [
      row({ id: "fresh", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60) }), // 1h old
      row({ id: "stale", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 900) }), // 900h old
      row({ id: "mid", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 100) }), // 100h old
    ];
    const picked = pickWeightedSample(rows, 3, NOW, () => 0.5);
    expect(picked.map((r) => r.id)).toEqual(["stale", "mid", "fresh"]);
  });

  it("floors weight at 1h so a just-verified attribute has a nonzero chance", () => {
    const rows = [row({ id: "just-verified", lastVerifiedAt: NOW })];
    const picked = pickWeightedSample(rows, 1, NOW, () => 0.5);
    expect(picked.map((r) => r.id)).toEqual(["just-verified"]);
  });

  it("is deterministic for a given rng sequence", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    let calls = 0;
    const sequence = [0.9, 0.1, 0.5];
    const rng = () => sequence[calls++ % sequence.length]!;
    const picked = pickWeightedSample(rows, 2, NOW, rng);
    expect(picked).toHaveLength(2);
    expect(picked.map((r) => r.id)).toEqual(["a", "c"]);
  });
});
