import { expect, test } from "@playwright/test";

// Layout target: 360px width minimum (smallest common Android viewport),
// tested at 360 and at 430 (the larger end of common phones, e.g. iPhone
// Pro Max / large Android). No horizontal scroll at either width — this is
// used one-handed, outdoors, on whatever phone the curator or visitor has.
for (const width of [360, 430]) {
  test(`no horizontal overflow at ${width}px width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
