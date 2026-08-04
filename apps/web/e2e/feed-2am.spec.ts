import { expect, test } from "@playwright/test";

// F1.1-F1.4, exercised against real seeded data (pnpm --filter @pulse/db
// db:seed): every seeded Newtown venue runs the same Fri/Sat 17:00-03:00
// shift, so simulating "now" at a couple of points either side of the
// 45-minute buffer around that 3am close turns the exclusion rule into a
// deterministic assertion instead of a coin flip on whatever real time the
// suite happens to run at. 2026-08-15 02:xx is a Saturday in Australia/
// Sydney — i.e. still "Friday night" for a shift that opened the evening
// before and crosses midnight.
const NEWTOWN = { precinct: "Newtown", lat: "-33.8975", lng: "151.1795", radiusMeters: "3000" };

function feedUrl(testNowIso: string): string {
  const params = new URLSearchParams({ ...NEWTOWN, _testNow: testNowIso });
  return `/api/feed?${params.toString()}`;
}

test("excludes every venue exactly 45 minutes from its 3am close", async ({ request }) => {
  // 2026-08-15T02:15 Sydney == 2026-08-14T16:15Z. now()+45min lands exactly
  // on the 03:00 close, which the query excludes with a strict "<".
  const response = await request.get(feedUrl("2026-08-14T16:15:00.000Z"));
  expect(response.ok()).toBe(true);
  const { venues } = await response.json();
  expect(Array.isArray(venues)).toBe(true);
  expect(venues).toEqual([]);
});

test("returns venues with an hour of runway before close, none closing within 45 minutes", async ({ request }) => {
  // 2026-08-15T02:00 Sydney == 2026-08-14T16:00Z — 60 minutes before the
  // 03:00 close, comfortably past the 45-minute buffer.
  const response = await request.get(feedUrl("2026-08-14T16:00:00.000Z"));
  expect(response.ok()).toBe(true);
  const { venues } = await response.json();
  expect(Array.isArray(venues)).toBe(true);
  expect(venues.length).toBeGreaterThan(0);

  for (const venue of venues) {
    expect(venue.precinct).toBe(NEWTOWN.precinct);
    expect(Array.isArray(venue.attributes)).toBe(true);
    // Every attribute is AttributeView-shaped: either value-bearing with
    // provenance, or explicitly unconfirmed — never a bare value.
    for (const attribute of venue.attributes) {
      if (attribute.confidence === "unconfirmed") {
        expect(attribute).not.toHaveProperty("value");
      } else {
        expect(attribute).toHaveProperty("value");
        expect(attribute).toHaveProperty("lastVerifiedAt");
        expect(attribute).toHaveProperty("verifiedBy");
      }
    }
  }
});
