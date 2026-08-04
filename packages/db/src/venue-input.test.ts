import { describe, expect, it } from "vitest";
import { generateSlug, hoursSpanMidnight, venueInputSchema } from "./venue-input";

describe("generateSlug", () => {
  it("lowercases, hyphenates, and strips punctuation", () => {
    expect(generateSlug("The Velvet Room")).toBe("the-velvet-room");
    expect(generateSlug("Bottle-O!!")).toBe("bottle-o");
  });
});

describe("hoursSpanMidnight", () => {
  it("is true for a past-midnight close", () => {
    expect(hoursSpanMidnight({ opensAt: "22:00", closesAt: "03:00" })).toBe(true);
  });

  it("is false for a same-day close", () => {
    expect(hoursSpanMidnight({ opensAt: "18:00", closesAt: "23:30" })).toBe(false);
  });

  it("is false when closed (no hours)", () => {
    expect(hoursSpanMidnight({ opensAt: null, closesAt: null })).toBe(false);
  });
});

const validInput = {
  name: "The Velvet Room",
  precinct: "Newtown",
  slug: "the-velvet-room",
  address: "1 King St, Newtown NSW",
  location: { lat: -33.895, lng: 151.18 },
  qualityTier: "flagship",
  curatorPitch: "Best late-night jazz in the precinct.",
  hours: [{ dayOfWeek: 5, isClosed: false, opensAt: "22:00", closesAt: "03:00", kitchenClosesAt: "23:00" }],
  attributes: [{ key: "dress_code", value: "smart casual" }],
};

describe("venueInputSchema", () => {
  it("accepts a fully valid venue", () => {
    expect(venueInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts a past-midnight hours row without rejecting closesAt < opensAt", () => {
    const result = venueInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it.each(["name", "precinct", "qualityTier", "curatorPitch"])("rejects a missing %s", (field) => {
    const { [field]: _omitted, ...rest } = validInput as Record<string, unknown>;
    expect(venueInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty hours array", () => {
    expect(venueInputSchema.safeParse({ ...validInput, hours: [] }).success).toBe(false);
  });

  it("rejects an unknown attribute key", () => {
    const result = venueInputSchema.safeParse({ ...validInput, attributes: [{ key: "made_up", value: "x" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an attribute value outside the registry's options", () => {
    const result = venueInputSchema.safeParse({ ...validInput, attributes: [{ key: "price_tier", value: "$$$$" }] });
    expect(result.success).toBe(false);
  });
});
