import { expect, test } from "@playwright/test";

// F1.5 list<->map toggle, exercised against real seeded data (same
// convention as feed-2am.spec.ts). Newtown's bbox (packages/db/scripts/
// seed.ts) is small enough — corner-to-center is well under 800m — that
// its bbox-centre coordinates put every seeded Newtown venue inside the
// relaxation ladder's first (smallest) radius rung, so all 15 seeded
// venues are candidates and the feed's default limit of 10 caps the result
// at exactly 10, giving a deterministic pin count.
const NEWTOWN_BBOX_CENTRE = { precinct: "Newtown", lat: "-33.897", lng: "151.18" };
// Same instant as feed-2am.spec.ts's "an hour of runway" case: Sat
// 2026-08-15 02:00 Sydney, 60 minutes before the seeded Fri/Sat 03:00
// close — comfortably past the 45-minute exclusion buffer.
const TEST_NOW = "2026-08-14T16:00:00.000Z";

function feedUrl(extraParams: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...NEWTOWN_BBOX_CENTRE, _testNow: TEST_NOW, ...extraParams });
  return `/?${params.toString()}`;
}

test("map toggle renders the same 10 feed venues as pins", async ({ page }) => {
  await page.goto(feedUrl());

  const toggle = page.getByTestId("map-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const mapContainer = page.getByTestId("venue-map-container");
  await expect(mapContainer).toBeVisible();

  const pins = page.locator('[data-testid^="map-pin-"]');
  await expect(pins).toHaveCount(10);

  // Tapping a pin opens the venue card.
  await pins.first().click();
  await expect(page).toHaveURL(/\/venue\/[^/]+\?source=map/);
});

test("map_enabled=false removes the toggle control from the DOM entirely", async ({ page }) => {
  await page.goto(feedUrl({ _mapEnabled: "false" }));

  await expect(page.getByTestId("map-toggle")).toHaveCount(0);
  await expect(page.getByTestId("venue-map-container")).toHaveCount(0);
});
