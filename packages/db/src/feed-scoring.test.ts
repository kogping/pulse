import { describe, expect, it } from "vitest";
import { DISTANCE_NORMALISER_METERS, FEED_SCORING_WEIGHTS } from "./feed";

// Pure arithmetic mirror of scoreSqlExpression() (feed.ts) — verifies the
// specific claim in FEED_SCORING_WEIGHTS's comment: a curator-authored
// venue with zero freshness should still lose to a Google Places venue
// (freshness 0, source bonus 0) that's meaningfully closer, but win at
// comparable distance. Not a substitute for an integration test against
// real Postgres — this only pins down the weight arithmetic, which is the
// part most likely to silently drift if someone tweaks a weight later.
function score(params: { distanceMeters: number; source: "curator" | "google_places"; freshnessScore?: number }): number {
  const normalisedDistance = Math.min(params.distanceMeters / DISTANCE_NORMALISER_METERS, 1);
  const sourceBonus = FEED_SCORING_WEIGHTS.source[params.source] ?? 0;
  const freshness = params.freshnessScore ?? 0;
  return FEED_SCORING_WEIGHTS.distance * normalisedDistance + FEED_SCORING_WEIGHTS.freshness * freshness + sourceBonus;
}

describe("feed scoring weights (city-wide coverage)", () => {
  it("a zero-info curated venue beats a zero-info Places venue at the same distance", () => {
    const curated = score({ distanceMeters: 500, source: "curator" });
    const places = score({ distanceMeters: 500, source: "google_places" });
    expect(curated).toBeGreaterThan(places);
  });

  it("a meaningfully closer Places venue still beats a farther curated venue", () => {
    const nearbyPlaces = score({ distanceMeters: 200, source: "google_places" });
    const farCurated = score({ distanceMeters: 2000, source: "curator" });
    expect(nearbyPlaces).toBeGreaterThan(farCurated);
  });

  it("the source bonus is worth exactly the documented ~400m of distance at the fixed normaliser", () => {
    // FEED_SCORING_WEIGHTS.source.curator (0.8) / |FEED_SCORING_WEIGHTS.distance| (4)
    // * DISTANCE_NORMALISER_METERS (2000) == the distance a curator venue can
    // trail by and still tie a same-freshness Places venue.
    const equivalentMeters = (FEED_SCORING_WEIGHTS.source.curator! / Math.abs(FEED_SCORING_WEIGHTS.distance)) * DISTANCE_NORMALISER_METERS;
    expect(equivalentMeters).toBeCloseTo(400, 0);

    const curatedAtCrossover = score({ distanceMeters: equivalentMeters, source: "curator" });
    const placesAtZero = score({ distanceMeters: 0, source: "google_places" });
    expect(curatedAtCrossover).toBeCloseTo(placesAtZero, 5);
  });

  it("google_places carries no source bonus — only distance and freshness can rank it", () => {
    expect(FEED_SCORING_WEIGHTS.source.google_places).toBe(0);
  });
});
