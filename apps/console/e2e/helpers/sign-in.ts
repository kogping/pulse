import type { APIRequestContext, Page } from "@playwright/test";

interface SentEmail {
  to: string;
  url: string;
  sentAt: string;
}

// Extracted from e2e/auth.spec.ts's inline flow — the magic-link sign-in
// round trip via the test-only inbox (see app/api/test/inbox/route.ts),
// reused by both queue.spec.ts and queue-offline.spec.ts.
export async function signIn(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByRole("status").waitFor();

  // The inbox is a single process-wide singleton for the whole Playwright
  // run (see lib/global-store.ts), so earlier specs signing in as the same
  // curator leave older entries in it — their magic-link tokens are
  // single-use and already consumed. Take the most recent match, not the
  // first.
  const inbox = (await (await request.get("/api/test/inbox")).json()) as { emails: SentEmail[] };
  const sent = [...inbox.emails].reverse().find((e) => e.to === email);
  if (!sent) throw new Error(`No sign-in email found for ${email}`);

  await page.goto(sent.url);
}
