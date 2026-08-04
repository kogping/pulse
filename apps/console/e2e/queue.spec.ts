import { devices, expect, test } from "@playwright/test";
import { setCpuThrottling, throttle4G } from "./helpers/throttle";
import { installTapCounter } from "./helpers/tap-counter";
import { signIn } from "./helpers/sign-in";

interface SeededItem {
  id: string;
  attributeKey: string;
  label: string;
  inputType: "select" | "text" | "boolean" | "time";
  options?: string[];
  current: { value: string; confidence: string; lastVerifiedAt: string };
}

// 360px, touch-capable — the queue's whole point is one-thumb use.
test.use({ ...devices["Pixel 5"], viewport: { width: 360, height: 800 } });
test.setTimeout(8 * 60 * 1000); // default 30s would kill a throttled 20-item run

// Corrected on their first appearance in the 20-item seed (see
// lib/queue-store.ts's seedTestQueue, which cycles the 10-entry
// ATTRIBUTE_REGISTRY twice) so all four input types go through the
// Correct -> value -> Submit path at least once — the path most at risk of
// exceeding 3 taps. Everything else takes the 1-tap "Still right" path.
const CORRECT_ON_FIRST_APPEARANCE_OF: ReadonlySet<string> = new Set([
  "queue_length", // select
  "cover_charge", // text
  "live_music_tonight", // boolean
  "last_entry_tonight", // time
]);

function shouldCorrect(item: SeededItem, indexInBatch: number): boolean {
  return indexInBatch < 10 && CORRECT_ON_FIRST_APPEARANCE_OF.has(item.attributeKey);
}

test("20-item queue: every item resolves in <=3 taps, whole batch under 6 minutes", async ({ page, request }) => {
  const seedResponse = await request.post("/api/test/queue-seed", { data: { size: 20 } });
  const { items } = (await seedResponse.json()) as { items: SeededItem[] };
  expect(items).toHaveLength(20);
  expect(new Set(items.map((i) => i.inputType))).toEqual(new Set(["select", "text", "boolean", "time"]));

  await signIn(page, request, "curator@pulse.test"); // unthrottled: sign-in isn't part of the throughput claim
  await page.goto("/queue");
  await expect(page.getByTestId("queue-item-prompt")).toBeVisible(); // warms next dev's compile before throttling

  await page.addInitScript(installTapCounter);
  const cdp = await throttle4G(page);
  await page.reload();
  await expect(page.getByTestId("queue-item-prompt")).toBeVisible();
  await setCpuThrottling(cdp, 4); // applied post-hydration; see helpers/throttle.ts

  const t0 = Date.now();
  const itemTimestamps: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const card = page.locator(`[data-queue-item="${item.id}"]`);
    await expect(card).toBeVisible();

    if (shouldCorrect(item, i)) {
      await card.getByRole("button", { name: "Correct" }).tap();
      if (item.inputType === "select" || item.inputType === "boolean") {
        const options = item.inputType === "boolean" ? ["yes", "no"] : (item.options ?? []);
        const target = options.find((o) => o !== item.current.value) ?? options[0]!;
        await card.getByRole("radio", { name: target, exact: true }).tap();
      } else {
        const value = item.inputType === "time" ? "19:30" : "Updated at the door";
        await card.locator("input").fill(value);
      }
      await card.getByRole("button", { name: "Submit" }).tap();
    } else {
      await card.getByRole("button", { name: "Still right" }).tap();
    }

    // Assert the toast appears and move straight on — do NOT wait it out.
    // 20 x 5s of sleeping would burn 28% of the 6-minute budget for nothing,
    // and a layout regression that lets the toast overlap the action row
    // would otherwise stall every item for the same 5s via Playwright's
    // actionability auto-wait, silently.
    await expect(page.getByRole("status")).toContainText("Undo");
    itemTimestamps.push(Date.now());
  }

  await expect(page.getByTestId("pending-count")).toHaveText("0", { timeout: 30_000 });
  const elapsedMs = Date.now() - t0;

  // Per-item guard: catches a silent stall (e.g. the toast-overlap bug)
  // that would otherwise only show up as a slow total.
  let previous = t0;
  for (const [i, at] of itemTimestamps.entries()) {
    expect(at - previous, `item ${i} took ${at - previous}ms`).toBeLessThan(8_000);
    previous = at;
  }

  expect(elapsedMs, `20 items took ${(elapsedMs / 1000).toFixed(1)}s`).toBeLessThan(6 * 60 * 1000);

  const counts = await page.evaluate(() => (window as unknown as { __tapCounts: Record<string, number> }).__tapCounts);
  expect(Object.keys(counts).sort()).toEqual(items.map((i) => i.id).sort());
  expect(counts["__none__"]).toBeUndefined();
  for (const item of items) {
    const taps = counts[item.id];
    expect(taps, `item ${item.id} (${item.attributeKey}) recorded 0 taps — counter did not observe the interaction`).toBeGreaterThanOrEqual(1);
    expect(taps, `item ${item.id} (${item.attributeKey}) took ${taps} taps`).toBeLessThanOrEqual(3);
  }

  // The server actually received every action, not just the optimistic UI.
  const state = (await (await request.get("/api/test/queue-seed")).json()) as { applied: unknown[] };
  expect(state.applied).toHaveLength(20);
});
