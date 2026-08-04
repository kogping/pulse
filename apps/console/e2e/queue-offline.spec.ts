import { devices, expect, test } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// Separate from queue.spec.ts deliberately: offline retries, backoff sleeps
// and reconnect waits would inject non-product seconds into that file's
// wall-clock assertion and make it flaky for reasons unrelated to the
// 3-tap/6-minute claim it exists to prove.
test.use({ ...devices["Pixel 5"], viewport: { width: 360, height: 800 } });

interface SeededItem {
  id: string;
}

async function readOutboxCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("pulse-console-outbox");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<number>((resolve, reject) => {
      const req = db.transaction("actions", "readonly").objectStore("actions").getAll();
      req.onsuccess = () => resolve((req.result as unknown[]).length);
      req.onerror = () => reject(req.error);
    });
  });
}

async function readOutboxIds(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("pulse-console-outbox");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<string[]>((resolve, reject) => {
      const req = db.transaction("actions", "readonly").objectStore("actions").getAll();
      req.onsuccess = () => resolve((req.result as Array<{ id: string }>).map((r) => r.id));
      req.onerror = () => reject(req.error);
    });
  });
}

test("actions taken offline persist to IndexedDB and flush exactly once on reconnect", async ({ page, context, request }) => {
  const seeded = await (await request.post("/api/test/queue-seed", { data: { size: 3 } })).json();
  const { items } = seeded as { items: SeededItem[] };

  await signIn(page, request, "curator@pulse.test");
  await page.goto("/queue");
  await expect(page.getByTestId("queue-item-prompt")).toBeVisible();

  await context.setOffline(true);
  for (const item of items) {
    await page.locator(`[data-queue-item="${item.id}"]`).getByRole("button", { name: "Still right" }).tap();
  }
  // UI advances optimistically even though nothing has been sent yet.
  await expect(page.getByTestId("pending-count")).toHaveText("3");

  const ids = await readOutboxIds(page);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3); // distinct idempotency keys

  await context.setOffline(false);
  // No manual online-event dispatch or forced flush: the backoff timer is
  // the production robustness mechanism (lib/outbox.ts), so this exercises
  // it rather than papering over it.
  await expect(page.getByTestId("pending-count")).toHaveText("0", { timeout: 30_000 });

  const state = (await (await request.get("/api/test/queue-seed")).json()) as { applied: Array<{ clientActionId: string }> };
  expect(state.applied).toHaveLength(3); // exactly 3 — proves no double-submit
  expect(new Set(state.applied.map((a) => a.clientActionId)).size).toBe(3);
});

test("undo inside the 5s window removes the action from the outbox without ever sending it", async ({ page, context, request }) => {
  const seeded = await (await request.post("/api/test/queue-seed", { data: { size: 1 } })).json();
  const { items } = seeded as { items: SeededItem[] };

  await signIn(page, request, "curator@pulse.test");
  await page.goto("/queue");
  await expect(page.getByTestId("queue-item-prompt")).toBeVisible();

  await context.setOffline(true);
  await page.locator(`[data-queue-item="${items[0]!.id}"]`).getByRole("button", { name: "Still right" }).tap();
  await expect(page.getByTestId("pending-count")).toHaveText("1");

  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("0");
  expect(await readOutboxCount(page)).toBe(0);

  await context.setOffline(false);
  const state = (await (await request.get("/api/test/queue-seed")).json()) as { applied: unknown[] };
  expect(state.applied).toHaveLength(0);
});

test("concurrent flush calls do not double-submit", async ({ page, request }) => {
  const seeded = await (await request.post("/api/test/queue-seed", { data: { size: 2 } })).json();
  const { items } = seeded as { items: SeededItem[] };

  await signIn(page, request, "curator@pulse.test");
  await page.goto("/queue");
  await expect(page.getByTestId("queue-item-prompt")).toBeVisible();

  for (const item of items) {
    await page.locator(`[data-queue-item="${item.id}"]`).getByRole("button", { name: "Still right" }).tap();
  }

  // Actions aren't send-eligible until their 5s undo grace window passes
  // (see OutboxAction.notBefore) — wait it out once, deterministically,
  // rather than relying on the backoff timer's own retries to eventually
  // clear it before the assertion below times out.
  await page.waitForTimeout(5_200);

  // Force two concurrent flush attempts via the test-only debug hook
  // (lib/outbox.ts) to prove the single-flight/navigator.locks guards
  // actually prevent a race, rather than relying on timing alone.
  await page.evaluate(async () => {
    const outbox = (window as unknown as { __pulseOutbox: { flush: () => Promise<void> } }).__pulseOutbox;
    await Promise.all([outbox.flush(), outbox.flush()]);
  });

  await expect(page.getByTestId("pending-count")).toHaveText("0");
  const state = (await (await request.get("/api/test/queue-seed")).json()) as { applied: unknown[] };
  expect(state.applied).toHaveLength(2);
});
