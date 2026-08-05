import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// F2.3: the directions deep link picks Apple Maps on iOS and Google Maps
// everywhere else. Driven against a real seeded venue (same NEWTOWN fixture
// and fixed instant as feed-2am.spec.ts, so it reliably finds an open venue
// regardless of when the suite actually runs) with navigator.userAgent
// stubbed per test to simulate each platform — there's only a chromium
// project (playwright.config.ts), so platform is simulated rather than run
// on real device browsers.
const NEWTOWN = { precinct: "Newtown", lat: "-33.8975", lng: "151.1795", radiusMeters: "3000" };
const TEST_NOW = "2026-08-14T16:00:00.000Z";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

function stubUserAgent(page: Page, userAgent: string) {
  return page.addInitScript((ua) => {
    // navigator.userAgent is a read-only accessor on the real Navigator
    // prototype — a plain assignment silently no-ops, so this has to go
    // through defineProperty, same as the geolocation stub in location.spec.ts.
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => ua });
  }, userAgent);
}

async function firstOpenSeededVenueId(request: APIRequestContext): Promise<string> {
  const params = new URLSearchParams({ ...NEWTOWN, _testNow: TEST_NOW });
  const response = await request.get(`/api/feed?${params.toString()}`);
  expect(response.ok()).toBe(true);
  const { venues } = await response.json();
  expect(venues.length).toBeGreaterThan(0);
  return venues[0].id;
}

test.describe("F2.3 directions deep link", () => {
  test("iOS opens Apple Maps", async ({ page, request }) => {
    const venueId = await firstOpenSeededVenueId(request);
    await stubUserAgent(page, IPHONE_UA);
    await page.goto(`/venue/${venueId}`);

    const href = await page.getByTestId("directions-link").getAttribute("href");
    expect(href).toMatch(/^https:\/\/maps\.apple\.com\//);
    expect(href).not.toContain("google.com");
  });

  test("non-iOS opens Google Maps", async ({ page, request }) => {
    const venueId = await firstOpenSeededVenueId(request);
    await stubUserAgent(page, ANDROID_UA);
    await page.goto(`/venue/${venueId}`);

    const href = await page.getByTestId("directions-link").getAttribute("href");
    expect(href).toMatch(/^https:\/\/www\.google\.com\/maps\//);
    expect(href).not.toContain("apple.com");
  });

  test("tapping directions fires directions_tapped", async ({ page, context, request }) => {
    const venueId = await firstOpenSeededVenueId(request);
    await stubUserAgent(page, ANDROID_UA);
    await page.goto(`/venue/${venueId}`);

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("directions-link").click(),
    ]);
    await popup.close();

    await page.goto("/debug/events");
    await expect(page.locator("table")).toContainText("directions_tapped");
  });
});
