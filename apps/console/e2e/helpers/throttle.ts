import type { CDPSession, Page } from "@playwright/test";

// Chrome DevTools "Slow 4G" preset — the same numbers Lighthouse uses for
// its mobile throttling profile. CDP wants bytes/sec; DevTools displays
// bits/sec, hence the /8 conversions.
export const SLOW_4G = {
  offline: false,
  latency: 150, // ms RTT
  downloadThroughput: (1.6 * 1024 * 1024) / 8, // 1.6 Mbit/s
  uploadThroughput: (750 * 1024) / 8, // 750 Kbit/s
} as const;

// CDP network emulation is attached per Page, not per BrowserContext — it
// must be re-established on any new page.
export async function throttle4G(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { ...SLOW_4G });
  return cdp;
}

export async function setCpuThrottling(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}
