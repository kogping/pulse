import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createVenue } from "./venues";
import { venueStore } from "./venue-store";

const CURATOR_ID = "test-curator-1";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "The Velvet Room",
    precinct: `precinct-${randomUUID()}`,
    slug: "the-velvet-room",
    address: "1 King St, Newtown NSW",
    location: { lat: -33.895, lng: 151.18 },
    qualityTier: "flagship",
    curatorPitch: "Best late-night jazz in the precinct.",
    hours: [{ dayOfWeek: 5, isClosed: false, opensAt: "22:00", closesAt: "03:00", kitchenClosesAt: "23:00" }],
    attributes: [
      { key: "dress_code", value: "smart casual" },
      { key: "wheelchair_accessible", value: "yes" },
    ],
    ...overrides,
  };
}

describe("createVenue", () => {
  it("returns 400 and creates no row when a required field is missing", async () => {
    const before = (await venueStore.listAll()).length;
    const input = baseInput();
    delete (input as Record<string, unknown>).curatorPitch;

    const result = await createVenue(input, CURATOR_ID);

    expect(result.status).toBe(400);
    expect((await venueStore.listAll()).length).toBe(before);
  });

  it("returns 400 and creates no row when there are no opening-hours rows", async () => {
    const before = (await venueStore.listAll()).length;
    const result = await createVenue(baseInput({ hours: [] }), CURATOR_ID);

    expect(result.status).toBe(400);
    expect((await venueStore.listAll()).length).toBe(before);
  });

  it("on a valid save, creates exactly one venue_attributes row and one verification_events row per attribute", async () => {
    const input = baseInput();
    const result = await createVenue(input, CURATOR_ID);
    expect(result.status).toBe(201);
    if (result.status !== 201) throw new Error("unreachable");

    const venue = await venueStore.getWithDetails(result.venueId);
    expect(venue).not.toBeNull();
    expect(venue!.attributes).toHaveLength(input.attributes.length);
    for (const attribute of venue!.attributes) {
      expect(attribute.verificationEventCount).toBe(1);
    }
    // Exactly one venue_attributes row per submitted attribute key, no duplicates.
    const keys = venue!.attributes.map((a) => a.key).sort();
    expect(keys).toEqual([...input.attributes.map((a) => a.key)].sort());
  });

  it("stores a 22:00-03:00 hours row and re-reads it as spanning midnight", async () => {
    const input = baseInput({
      hours: [{ dayOfWeek: 6, isClosed: false, opensAt: "22:00", closesAt: "03:00", kitchenClosesAt: "23:30" }],
    });
    const result = await createVenue(input, CURATOR_ID);
    expect(result.status).toBe(201);
    if (result.status !== 201) throw new Error("unreachable");

    const venue = await venueStore.getWithDetails(result.venueId);
    const row = venue!.hours[0]!;
    expect(row.opensAt).toBe("22:00");
    expect(row.closesAt).toBe("03:00");
    expect(row.closesAt! < row.opensAt!).toBe(true); // spans midnight
  });

  it("rejects a duplicate slug within the same precinct", async () => {
    const precinct = `precinct-${randomUUID()}`;
    const first = await createVenue(baseInput({ precinct }), CURATOR_ID);
    expect(first.status).toBe(201);

    const second = await createVenue(baseInput({ precinct }), CURATOR_ID);
    expect(second.status).toBe(409);
  });

  it("allows the same slug in two different precincts", async () => {
    const slug = `shared-slug-${randomUUID()}`;
    const first = await createVenue(baseInput({ precinct: `precinct-a-${randomUUID()}`, slug }), CURATOR_ID);
    const second = await createVenue(baseInput({ precinct: `precinct-b-${randomUUID()}`, slug }), CURATOR_ID);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});
