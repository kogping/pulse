import { describe, expect, it } from "vitest";
import { buildGridCells, parseArgs, subdivide, suburbFromAddressComponents, toCandidate, toHoursRows } from "./parse";

describe("buildGridCells", () => {
  it("covers a small bbox with at least one cell", () => {
    const cells = buildGridCells([151.0, -33.9, 151.02, -33.88]);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.depth).toBe(0);
      expect(cell.radiusMeters).toBeGreaterThan(0);
    }
  });

  it("produces more cells for a larger bbox", () => {
    const small = buildGridCells([151.0, -33.9, 151.02, -33.88]);
    const large = buildGridCells([150.52, -34.17, 151.35, -33.58]);
    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe("subdivide", () => {
  it("returns 4 quadrants at half the radius, one depth deeper", () => {
    const parent = { lat: -33.87, lng: 151.2, radiusMeters: 1000, depth: 1 };
    const children = subdivide(parent);
    expect(children).toHaveLength(4);
    for (const child of children) {
      expect(child.radiusMeters).toBe(500);
      expect(child.depth).toBe(2);
    }
    // Quadrants should straddle the parent centre — two above, two below.
    const above = children.filter((c) => c.lat > parent.lat);
    const below = children.filter((c) => c.lat < parent.lat);
    expect(above).toHaveLength(2);
    expect(below).toHaveLength(2);
  });
});

describe("toHoursRows", () => {
  it("maps a same-day period to one opaque HH:mm row", () => {
    const rows = toHoursRows([{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 5, hour: 23, minute: 30 } }]);
    expect(rows).toEqual([{ dayOfWeek: 5, isClosed: false, opensAt: "18:00", closesAt: "23:30" }]);
  });

  it("a period crossing midnight yields closesAt <= opensAt, matching the past-midnight convention", () => {
    const rows = toHoursRows([{ open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 3, minute: 0 } }]);
    expect(rows).toEqual([{ dayOfWeek: 5, isClosed: false, opensAt: "22:00", closesAt: "03:00" }]);
    expect(rows[0]!.closesAt! <= rows[0]!.opensAt!).toBe(true);
  });

  it("skips a period missing open or close", () => {
    const rows = toHoursRows([{ open: { day: 1, hour: 9, minute: 0 } }, {}]);
    expect(rows).toEqual([]);
  });

  it("returns no rows for an empty periods list, never inventing hours", () => {
    expect(toHoursRows([])).toEqual([]);
  });
});

describe("suburbFromAddressComponents", () => {
  it("prefers the locality component", () => {
    const suburb = suburbFromAddressComponents([
      { longText: "123", types: ["street_number"] },
      { longText: "Newtown", types: ["locality", "political"] },
      { longText: "NSW", types: ["administrative_area_level_1"] },
    ]);
    expect(suburb).toBe("Newtown");
  });

  it("falls back to sublocality when there's no locality", () => {
    const suburb = suburbFromAddressComponents([{ longText: "Haymarket", types: ["sublocality", "political"] }]);
    expect(suburb).toBe("Haymarket");
  });

  it("returns null when neither is present", () => {
    expect(suburbFromAddressComponents([{ longText: "NSW", types: ["administrative_area_level_1"] }])).toBeNull();
    expect(suburbFromAddressComponents(undefined)).toBeNull();
  });
});

describe("toCandidate", () => {
  const basePlace = {
    id: "place-123456",
    displayName: { text: "The Test Bar" },
    location: { latitude: -33.87, longitude: 151.2 },
    addressComponents: [{ longText: "Surry Hills", types: ["locality"] }],
    regularOpeningHours: { periods: [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 5, hour: 23, minute: 0 } }] },
    businessStatus: "OPERATIONAL",
  };

  it("builds a candidate from a well-formed operational place", () => {
    const candidate = toCandidate(basePlace);
    expect(candidate).toEqual({
      externalPlaceId: "place-123456",
      name: "The Test Bar",
      precinct: "Surry Hills",
      lat: -33.87,
      lng: 151.2,
      hours: [{ dayOfWeek: 5, isClosed: false, opensAt: "18:00", closesAt: "23:00" }],
    });
  });

  it("drops a non-operational place — never surfaces a closed-down venue", () => {
    expect(toCandidate({ ...basePlace, businessStatus: "CLOSED_PERMANENTLY" })).toBeNull();
  });

  it("drops a place missing a name or coordinates", () => {
    expect(toCandidate({ ...basePlace, displayName: undefined })).toBeNull();
    expect(toCandidate({ ...basePlace, location: undefined })).toBeNull();
  });

  it("falls back to a generic precinct label when address components carry no locality", () => {
    const candidate = toCandidate({ ...basePlace, addressComponents: undefined });
    expect(candidate?.precinct).toBe("Sydney");
  });

  it("carries through zero hours rather than inventing a schedule", () => {
    const candidate = toCandidate({ ...basePlace, regularOpeningHours: undefined });
    expect(candidate?.hours).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("defaults to Greater Sydney and no dry-run", () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(false);
    expect(args.bbox).toEqual([150.52, -34.17, 151.35, -33.58]);
    expect(args.maxRequests).toBe(4000);
  });

  it("parses --dry-run, --bbox, and --max-requests", () => {
    const args = parseArgs(["--dry-run", "--bbox=151.24,-33.90,151.29,-33.87", "--max-requests=20"]);
    expect(args.dryRun).toBe(true);
    expect(args.bbox).toEqual([151.24, -33.9, 151.29, -33.87]);
    expect(args.maxRequests).toBe(20);
  });

  it("throws on a malformed --bbox", () => {
    expect(() => parseArgs(["--bbox=not,a,bbox"])).toThrow();
  });
});
