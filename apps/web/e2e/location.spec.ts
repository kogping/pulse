import { expect, test, type Page, type Route } from "@playwright/test";

// F1.1's non-happy-path branches for resolving "where is this visitor",
// driven with a stubbed `navigator.geolocation` (Playwright's own
// permission/geolocation APIs model the browser prompt, not the timing and
// error-code variety this needs) and mocked /api responses so the test
// doesn't depend on live Edge Config precinct flags. A distinctive
// coordinate pair stands in for "the visitor's real GPS fix" so the
// network-log assertion at the bottom can prove it never leaves the one
// request it's meant for.
const VISITOR_LAT = -33.912345;
const VISITOR_LNG = 151.187654;

const NEWTOWN = { id: "newtown", name: "Newtown", lat: -33.8975, lng: 151.1795 };

function stubGeolocationSuccess(page: Page, lat: number, lng: number) {
  return page.addInitScript(
    ({ lat, lng }) => {
      // navigator.geolocation is an accessor property on the real
      // Geolocation API — a plain assignment silently no-ops, so this has
      // to go through defineProperty to actually replace it.
      Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (success: PositionCallback) => {
            success({ coords: { latitude: lat, longitude: lng, accuracy: 10 } } as GeolocationPosition);
          },
        },
      });
    },
    { lat, lng },
  );
}

function stubGeolocationDenied(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
          error({ code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1 } as GeolocationPositionError);
        },
      },
    });
  });
}

function stubGeolocationHangs(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        // Never calls either callback — models a fix that never arrives
        // inside the app's own soft timeout.
        getCurrentPosition: () => {},
      },
    });
  });
}

test.describe("F1.1 location resolution", () => {
  test("granted permission resolves to the nearest enabled precinct and renders its feed", async ({ page }) => {
    const requests: { url: string; postData: string | null }[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), postData: request.postData() }));

    await page.route("**/api/location/resolve*", (route: Route) =>
      route.fulfill({ json: { status: "resolved", precinct: NEWTOWN } }),
    );

    await stubGeolocationSuccess(page, VISITOR_LAT, VISITOR_LNG);
    await page.goto("/");

    await expect(page).toHaveURL(/precinct=Newtown/);
    await expect(page.getByTestId("precinct-switcher-open")).toHaveText("Newtown");
    await expect(page.getByTestId("location-resolving")).toHaveCount(0);
    await expect(page.getByTestId("precinct-picker")).toHaveCount(0);

    assertCoordinatesOnlyLeakToResolve(requests);
  });

  test("denied permission falls back to the precinct picker, remembered for next time", async ({ page }) => {
    await stubGeolocationDenied(page);
    await page.route("**/api/precincts", (route: Route) => route.fulfill({ json: { precincts: [NEWTOWN] } }));
    await page.goto("/");

    await expect(page.getByTestId("precinct-picker")).toBeVisible();
    await page.getByRole("button", { name: "Newtown" }).click();

    await expect(page).toHaveURL(/precinct=Newtown/);
    await expect(page.getByTestId("precinct-switcher-open")).toHaveText("Newtown");

    // Remembered: a fresh navigation never re-shows the picker or re-asks
    // geolocation, even though the stub would still deny it.
    await page.goto("/");
    await expect(page).toHaveURL(/precinct=Newtown/);
    await expect(page.getByTestId("precinct-picker")).toHaveCount(0);
  });

  test("location outside every enabled precinct shows the out-of-coverage screen and captures an email", async ({
    page,
  }) => {
    const requests: { url: string; postData: string | null }[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), postData: request.postData() }));

    await page.route("**/api/location/resolve*", (route: Route) => route.fulfill({ json: { status: "out_of_coverage" } }));
    await page.route("**/api/out-of-coverage", (route: Route) => route.fulfill({ status: 201, json: { ok: true } }));

    await stubGeolocationSuccess(page, VISITOR_LAT, VISITOR_LNG);
    await page.goto("/");

    await expect(page.getByTestId("out-of-coverage-screen")).toBeVisible();
    await page.getByLabel("Suburb").fill("Wollongong");
    await page.getByLabel("Email").fill("visitor@example.com");
    await page.getByRole("button", { name: "Notify me" }).click();

    await expect(page.getByTestId("out-of-coverage-done")).toBeVisible();
    await expect(page.getByTestId("out-of-coverage-done")).toContainText("Wollongong");

    const captureRequest = requests.find((request) => request.url.includes("/api/out-of-coverage"));
    expect(captureRequest?.postData).toBeTruthy();
    const body = JSON.parse(captureRequest!.postData!);
    expect(body).toEqual({ email: "visitor@example.com", suburb: "Wollongong" });

    assertCoordinatesOnlyLeakToResolve(requests);
  });

  test("geolocation slower than 3s renders the precinct picker instead of a spinner", async ({ page }) => {
    await stubGeolocationHangs(page);
    await page.route("**/api/precincts", (route: Route) => route.fulfill({ json: { precincts: [NEWTOWN] } }));
    await page.goto("/");

    await expect(page.getByTestId("location-resolving")).toBeVisible();
    await expect(page.getByTestId("precinct-picker")).toBeVisible({ timeout: 4_000 });
  });
});

// The one and only request that should ever see the visitor's real
// coordinates is /api/location/resolve — CLAUDE.md invariant 6 ("the
// request carries them, the response is computed, they are dropped") and
// the spec's "never sent to any analytics call and never written to the
// DB". Every other request captured during the test — including the page
// navigation itself, /api/precincts, and /api/out-of-coverage — must not
// carry the coordinate pair the geolocation stub returned.
function assertCoordinatesOnlyLeakToResolve(requests: { url: string; postData: string | null }[]) {
  const coordMarker = `${VISITOR_LAT}`;
  const leaks = requests.filter((request) => {
    const carriesCoord = request.url.includes(coordMarker) || (request.postData?.includes(coordMarker) ?? false);
    return carriesCoord && !request.url.includes("/api/location/resolve");
  });
  expect(leaks, JSON.stringify(leaks)).toEqual([]);
}
