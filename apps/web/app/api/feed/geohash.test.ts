import { describe, expect, it } from "vitest";
import { geohashDecode, geohashEncode, haversineDistanceMeters } from "./geohash";

describe("geohashDecode", () => {
  it("decodes to a point within the cell, close to the original coordinates", () => {
    const original = { lat: -33.912345, lng: 151.187654 };
    const cell = geohashDecode(geohashEncode(original.lat, original.lng, 6));

    // geohash-6 cells are ~1.2km x 0.6km at this latitude — the decoded
    // centre must be nearby, but is never expected to equal the input
    // exactly (that's the point: it's a deliberate precision loss before
    // the coordinate ever reaches a URL — see location-gate.tsx).
    expect(haversineDistanceMeters(original, cell)).toBeLessThan(1000);
    expect(cell).not.toEqual(original);
  });

  it("two nearby points in the same geohash-6 cell decode to the identical centre", () => {
    const a = { lat: -33.8688, lng: 151.2093 };
    const b = { lat: -33.8686, lng: 151.2091 };
    expect(geohashEncode(a.lat, a.lng, 6)).toBe(geohashEncode(b.lat, b.lng, 6));
    expect(geohashDecode(geohashEncode(a.lat, a.lng, 6))).toEqual(geohashDecode(geohashEncode(b.lat, b.lng, 6)));
  });

  it("round-trips at higher precision to a tighter tolerance", () => {
    const original = { lat: -33.912345, lng: 151.187654 };
    const cell9 = geohashDecode(geohashEncode(original.lat, original.lng, 9));
    expect(haversineDistanceMeters(original, cell9)).toBeLessThan(3);
  });
});
