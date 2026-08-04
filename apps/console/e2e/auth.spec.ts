import { expect, test } from "@playwright/test";

const GENERIC_MESSAGE = "If that email is on our curator list, we've sent a sign-in link.";
const ALLOW_LISTED_EMAIL = "curator@pulse.test";
const UNKNOWN_EMAIL = "stranger@example.com";

interface SentEmail {
  to: string;
  url: string;
  sentAt: string;
}

async function getInbox(request: import("@playwright/test").APIRequestContext): Promise<SentEmail[]> {
  const response = await request.get("/api/test/inbox");
  const body = await response.json();
  return body.emails;
}

async function requestSignInLink(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(GENERIC_MESSAGE);
}

test("allow-listed email receives a link and reaches /queue", async ({ page, request }) => {
  await requestSignInLink(page, ALLOW_LISTED_EMAIL);

  const inbox = await getInbox(request);
  const sent = inbox.find((email) => email.to === ALLOW_LISTED_EMAIL);
  expect(sent).toBeDefined();

  await page.goto(sent!.url);
  await expect(page).toHaveURL(/\/queue$/);
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
});

test("non-allow-listed email gets the same generic response and no email is dispatched", async ({ page, request }) => {
  const before = await getInbox(request);

  await requestSignInLink(page, UNKNOWN_EMAIL);

  const after = await getInbox(request);
  expect(after.filter((email) => email.to === UNKNOWN_EMAIL)).toHaveLength(0);
  expect(after.length).toBe(before.length);
});

test("unauthenticated request to /queue redirects to /signin", async ({ page }) => {
  await page.goto("/queue");
  await expect(page).toHaveURL(/\/signin$/);
});
