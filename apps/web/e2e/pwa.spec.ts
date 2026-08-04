import { expect, test } from "@playwright/test";

// Lighthouse's PWA category (installable-manifest, maskable-icon,
// service-worker audits) was removed from Lighthouse itself around v10 —
// current Lighthouse (13.x, checked against the installed version and a
// pulled 12.8.2 tarball) ships none of those audits any more. The
// installability verdict they used to compute now lives directly in
// Chrome, exposed over the DevTools Protocol as
// Page.getInstallabilityErrors — the same signal that drives the browser's
// own "Install app" affordance. That's what this spec drives instead.
test("the app is installable per Chrome's own installability check", async ({ page, context }) => {
  await page.goto("/");
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors, JSON.stringify(installabilityErrors)).toEqual([]);
});

test("the manifest has the fields Chrome requires for installability", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();

  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.display).toBe("standalone");

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
});

test("declared icons resolve to real images", async ({ request }) => {
  for (const path of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png"]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});

test("the service worker registers and takes control of the page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The document that triggers the SW's own install is never controlled by
  // it (the fetch already happened over the network) — controller only
  // shows up from the next navigation onward.
  await page.reload();
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  expect(controlled).toBe(true);
});

test("the service worker cache holds the app shell but never an /api/ response", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Force the shell to actually be fetched (and thus cached) once more,
  // then inspect Cache Storage directly.
  await page.reload();
  await page.waitForTimeout(250);

  const cachedUrls: string[] = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const urls: string[] = [];
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      urls.push(...requests.map((r) => r.url));
    }
    return urls;
  });

  expect(cachedUrls.length).toBeGreaterThan(0);
  const apiEntries = cachedUrls.filter((url) => new URL(url).pathname.startsWith("/api/"));
  expect(apiEntries, JSON.stringify(apiEntries)).toEqual([]);
});
