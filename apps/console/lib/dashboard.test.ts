import { describe, expect, it } from "vitest";
import { ATTRIBUTE_REGISTRY } from "@pulse/db";
import {
  computeCoverage,
  computeMeanBadgeAge,
  computeOpenFlags,
  computeWorstFlagRate,
  type BadgeAgeRow,
  type OpenFlagRow,
  type VenueAttributeStateRow,
  type VenueFlagWeekRow,
} from "./dashboard";

const NOW = new Date("2026-08-04T20:00:00Z");
const ALL_KEYS = ATTRIBUTE_REGISTRY.map((entry) => entry.key);

function freshStateRows(venueId: string, precinct: string): VenueAttributeStateRow[] {
  // 'static' class: fresh for 720h. NOW itself is trivially fresh.
  return ALL_KEYS.map((attributeKey) => ({ venueId, precinct, attributeKey, lastVerifiedAt: NOW, flagCount: 0 }));
}

describe("computeCoverage", () => {
  it("counts a venue as covered only when every required attribute is fresh", () => {
    const rows: VenueAttributeStateRow[] = [
      ...freshStateRows("v1", "Newtown"),
      // v2 is missing one attribute -> not fully fresh, even though the
      // ones it has are fresh.
      ...freshStateRows("v2", "Newtown").slice(0, ALL_KEYS.length - 1),
    ];
    const result = computeCoverage(rows, NOW);
    expect(result).toEqual([{ precinct: "Newtown", totalVenues: 2, fullyFreshVenues: 1, coveragePct: 50 }]);
  });

  it("does not count 'ageing' attributes toward coverage", () => {
    const rows: VenueAttributeStateRow[] = freshStateRows("v1", "Kings Cross").map((row) =>
      row.attributeKey === "dress_code" ? { ...row, lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 800) } : row,
    );
    const result = computeCoverage(rows, NOW);
    expect(result).toEqual([{ precinct: "Kings Cross", totalVenues: 1, fullyFreshVenues: 0, coveragePct: 0 }]);
  });

  it("splits venues across precincts and sorts by precinct name", () => {
    const rows: VenueAttributeStateRow[] = [...freshStateRows("v1", "Newtown"), ...freshStateRows("v2", "Kings Cross")];
    const result = computeCoverage(rows, NOW);
    expect(result.map((r) => r.precinct)).toEqual(["Kings Cross", "Newtown"]);
    expect(result.every((r) => r.coveragePct === 100)).toBe(true);
  });
});

describe("computeMeanBadgeAge", () => {
  it("computes the mean age per precinct and per attribute", () => {
    const rows: BadgeAgeRow[] = [
      { precinct: "Newtown", attributeKey: "queue_length", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 2) },
      { precinct: "Newtown", attributeKey: "queue_length", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 6) },
      { precinct: "Kings Cross", attributeKey: "dress_code", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 10) },
    ];
    const { byPrecinct, byAttribute } = computeMeanBadgeAge(rows, NOW);
    expect(byPrecinct).toEqual([
      { key: "Kings Cross", meanAgeHours: 10, count: 1 },
      { key: "Newtown", meanAgeHours: 4, count: 2 },
    ]);
    expect(byAttribute).toEqual([
      { key: "dress_code", meanAgeHours: 10, count: 1 },
      { key: "queue_length", meanAgeHours: 4, count: 2 },
    ]);
  });
});

describe("computeWorstFlagRate", () => {
  it("ranks by flags-per-attribute, not raw flag count", () => {
    const rows: VenueFlagWeekRow[] = [
      { venueId: "a", venueName: "Small but flagged", flagCount: 2, attributeCount: 2 }, // rate 1.0
      { venueId: "b", venueName: "Big and flagged", flagCount: 3, attributeCount: 10 }, // rate 0.3
      { venueId: "c", venueName: "Clean", flagCount: 0, attributeCount: 5 }, // rate 0
    ];
    const result = computeWorstFlagRate(rows, 10);
    expect(result.map((r) => r.venueId)).toEqual(["a", "b", "c"]);
    expect(result[0]!.ratePerAttribute).toBe(1);
  });

  it("respects the limit", () => {
    const rows: VenueFlagWeekRow[] = Array.from({ length: 15 }, (_, i) => ({
      venueId: `v${i}`,
      venueName: `Venue ${i}`,
      flagCount: i,
      attributeCount: 1,
    }));
    const result = computeWorstFlagRate(rows, 10);
    expect(result).toHaveLength(10);
    expect(result[0]!.venueId).toBe("v14");
  });

  it("treats zero-attribute venues as rate 0, not NaN/Infinity", () => {
    const rows: VenueFlagWeekRow[] = [{ venueId: "a", venueName: "No attributes", flagCount: 3, attributeCount: 0 }];
    expect(computeWorstFlagRate(rows)[0]!.ratePerAttribute).toBe(0);
  });
});

describe("computeOpenFlags", () => {
  it("sorts oldest first and attaches age in hours", () => {
    const rows: OpenFlagRow[] = [
      { id: "newer", venueId: "v1", venueName: "A", attributeKey: "cover_charge", flaggedAt: new Date(NOW.getTime() - 1000 * 60 * 60) },
      { id: "older", venueId: "v2", venueName: "B", attributeKey: "dress_code", flaggedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 48) },
    ];
    const result = computeOpenFlags(rows, NOW);
    expect(result.map((r) => r.id)).toEqual(["older", "newer"]);
    expect(result[0]!.ageHours).toBe(48);
    expect(result[1]!.ageHours).toBe(1);
  });
});
