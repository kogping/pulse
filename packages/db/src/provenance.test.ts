import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  attributeViewSchema,
  buildAttributeView,
  buildVenueCard,
  type AttributeView,
  type AttributeViewRow,
} from "./provenance";
import { findDirectAttributeImportViolations } from "./attribute-import-guard";

const NOW = new Date("2026-08-05T10:00:00Z");

function row(overrides: Partial<AttributeViewRow> = {}): AttributeViewRow {
  return {
    venueId: "venue-1",
    attributeKey: "cover_charge",
    value: "$15",
    lastVerifiedAt: NOW,
    flagCount: 0,
    verifiedByCuratorId: "curator-1",
    verifiedByName: "Alex Nguyen",
    verifiedByTier: "standard",
    ...overrides,
  };
}

// Seed-shaped fixture data: one row per attribute class/edge case a real
// venue_attributes + curators join could produce.
const SEED_ROWS: AttributeViewRow[] = [
  row({ attributeKey: "cover_charge", value: "$15", lastVerifiedAt: NOW }), // fresh (nightly, 0h old)
  row({
    attributeKey: "dress_code",
    value: "smart casual",
    lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 40), // 40d old, static class -> ageing
  }),
  row({
    attributeKey: "queue_length",
    value: "long (20+ min)",
    lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 100), // 100h old, realtime class -> unconfirmed
  }),
  row({
    attributeKey: "live_music_tonight",
    value: "yes",
    lastVerifiedAt: NOW,
    verifiedByCuratorId: null,
    verifiedByName: null,
    verifiedByTier: null,
  }), // otherwise-fresh but the verifying curator is gone
];

describe("provenance: buildAttributeView", () => {
  it("parses every seed row as AttributeView with no extra value-bearing keys", () => {
    for (const seedRow of SEED_ROWS) {
      const view = buildAttributeView(seedRow, NOW);
      const result = attributeViewSchema.safeParse(view);
      expect(result.success, result.success ? "" : JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  it("carries key + value + verifiedBy for a fresh attribute", () => {
    const view = buildAttributeView(row(), NOW);
    expect(view).toEqual<AttributeView>({
      key: "cover_charge",
      value: "$15",
      confidence: "fresh",
      lastVerifiedAt: NOW,
      verifiedBy: { curatorId: "curator-1", name: "Alex Nguyen", tier: "standard" },
    });
  });

  it("decays to ageing without dropping provenance", () => {
    const view = buildAttributeView(
      row({ attributeKey: "dress_code", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 40) }),
      NOW,
    );
    expect(view.confidence).toBe("ageing");
    if (view.confidence !== "unconfirmed") {
      expect(view.verifiedBy).toEqual({ curatorId: "curator-1", name: "Alex Nguyen", tier: "standard" });
    }
  });

  it("drops to unconfirmed and carries no value once stale", () => {
    const view = buildAttributeView(
      row({ attributeKey: "queue_length", lastVerifiedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 100) }),
      NOW,
    );
    expect(view).toEqual({ key: "queue_length", confidence: "unconfirmed" });
    expect("value" in view).toBe(false);
    expect("verifiedBy" in view).toBe(false);
  });

  it("drops to unconfirmed when the verifying curator no longer exists, even if otherwise fresh", () => {
    const view = buildAttributeView(
      row({ verifiedByCuratorId: null, verifiedByName: null, verifiedByTier: null }),
      NOW,
    );
    expect(view).toEqual({ key: "cover_charge", confidence: "unconfirmed" });
  });
});

describe("provenance: buildVenueCard", () => {
  it("shapes every attribute through AttributeView and scopes rows to the venue", () => {
    const otherVenueRow = row({ venueId: "venue-2", attributeKey: "price_tier", value: "$$" });
    const card = buildVenueCard({ id: "venue-1", name: "The Lansdowne", precinct: "Chippendale" }, [...SEED_ROWS, otherVenueRow], NOW);

    expect(card.id).toBe("venue-1");
    expect(card.attributes).toHaveLength(SEED_ROWS.length);
    for (const attribute of card.attributes) {
      expect(attributeViewSchema.safeParse(attribute).success).toBe(true);
    }
  });
});

describe("provenance: CI grep test for direct venue_attributes imports", () => {
  const fixturesDir = path.join(import.meta.dirname, "..", "scripts", "__fixtures__", "direct-attribute-import");

  it("flags a static import of venueAttributes from @pulse/db", () => {
    const violations = findDirectAttributeImportViolations(path.join(fixturesDir, "violation"));
    expect(violations).toContain("route.ts");
  });

  it("flags a dynamic import of venueAttributes from @pulse/db", () => {
    const violations = findDirectAttributeImportViolations(path.join(fixturesDir, "violation"));
    expect(violations).toContain("dynamic-route.ts");
  });

  it("does not flag code that only reads through the provenance-typed API", () => {
    const violations = findDirectAttributeImportViolations(path.join(fixturesDir, "clean"));
    expect(violations).toEqual([]);
  });
});
