import { expect, test, type APIRequestContext } from "@playwright/test";

// F3.x "this looks wrong": flags a badge from the public PWA and confirms
// the same correction_flags row shows up in the curator console's real
// verification queue — the two apps' e2e suites otherwise run against
// different data (apps/console's AUTH_TEST_MODE swaps in an in-memory
// fixture store, see queue-store.ts). This spec signs into console via the
// live-session test route (app/api/test/live-session, gated by
// E2E_LIVE_SESSION_TEST_MODE, distinct from AUTH_TEST_MODE) so the console
// side takes its normal Drizzle-backed path against the same Postgres
// apps/web's own e2e already assumes is live and seeded.
const PRECINCT = "Newtown";
const CONSOLE_BASE_URL = "http://127.0.0.1:4300";
const POLL_BUDGET_MS = 60_000;

interface FlaggableVenue {
  venueId: string;
  attributeKey: string;
  precinct: string;
}

async function findFlaggableVenue(request: APIRequestContext): Promise<FlaggableVenue> {
  const response = await request.get(`/api/test/flaggable-attribute?precinct=${encodeURIComponent(PRECINCT)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as FlaggableVenue;
}

test.describe("F3.x this looks wrong", () => {
  test("flagging a badge in apps/web appears in the console queue within 60s", async ({ page, request, browser }) => {
    const { venueId, attributeKey, precinct } = await findFlaggableVenue(request);

    await page.goto(`/venue/${venueId}`);
    await page.getByTestId(`flag-attribute-${attributeKey}`).click();
    await page.getByTestId("flag-reason").fill("this looks wrong to me");
    await page.getByTestId("flag-submit").click();
    await expect(page.getByTestId(`flag-status-${attributeKey}`)).toHaveText("Reported — thanks");

    const consoleContext = await browser.newContext({ baseURL: CONSOLE_BASE_URL });
    const signInResponse = await consoleContext.request.post("/api/test/live-session", {
      data: { precinctId: precinct },
    });
    expect(signInResponse.ok()).toBe(true);

    const consolePage = await consoleContext.newPage();
    const deadline = Date.now() + POLL_BUDGET_MS;
    let found = false;
    while (Date.now() < deadline && !found) {
      await consolePage.goto("/queue");
      const prompt = consolePage.getByTestId("queue-item-prompt");
      if (await prompt.isVisible()) {
        const text = await consolePage.locator("text=flagged by a visitor").count();
        if (text > 0) {
          found = true;
          break;
        }
      }
      await consolePage.waitForTimeout(2_000);
    }

    expect(found).toBe(true);
    await consoleContext.close();
  });

  test("a 6th flag in an hour writes no row", async ({ page, request }) => {
    const { venueId, attributeKey } = await findFlaggableVenue(request);
    await page.goto(`/venue/${venueId}`); // establishes this test's own session-hash cookie

    // Real in-page fetch(), not the `request`/`page.request` API-testing
    // fixtures: those use a separate networking layer whose cookie-jar sync
    // with a prior page.goto proved unreliable, whereas an in-page fetch
    // rides the browser's own cookie store — the same path the real
    // FlagControl component uses — so it reliably carries the session-hash
    // cookie middleware.ts set on the goto above, which is the whole point
    // since the rate limit is keyed by that cookie.
    const countParams = new URLSearchParams({ venueId, attributeKey });
    const before = (await (await page.request.get(`/api/test/flag-count?${countParams.toString()}`)).json()) as {
      count: number;
    };

    for (let i = 0; i < 6; i++) {
      const status = await page.evaluate(
        async ({ venueId, attributeKey, i }) => {
          const response = await fetch("/api/flag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueId, attributeKey, reason: `attempt ${i}` }),
          });
          return response.status;
        },
        { venueId, attributeKey, i },
      );
      // Rate-limited attempts get the same 200 as a successful write —
      // CLAUDE.md: "do not teach abusers where the wall is" — so the only
      // observable difference is the row count below, not this response.
      expect(status).toBe(200);
    }

    const after = (await (await page.request.get(`/api/test/flag-count?${countParams.toString()}`)).json()) as {
      count: number;
    };
    expect(after.count - before.count).toBe(5);
  });
});
