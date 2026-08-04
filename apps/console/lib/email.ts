// Sends the magic-link email. In AUTH_TEST_MODE, nothing goes over the
// network — the message is recorded in-memory and read back via
// /api/test/inbox, so Playwright can drive the real sign-in flow without a
// real mailbox. In production, it's a plain fetch to the Resend HTTP API
// (no SDK dependency, so this only adds next-auth to apps/console's
// dependency graph, not an email SDK too).
import { globalSingleton } from "./global-store";

export interface SentEmail {
  to: string;
  url: string;
  sentAt: string;
}

const inbox: SentEmail[] = globalSingleton("email-inbox", () => []);

export function getInbox(): SentEmail[] {
  return inbox;
}

export async function sendMagicLinkEmail(params: { to: string; url: string }): Promise<void> {
  if (process.env.AUTH_TEST_MODE === "1") {
    inbox.push({ to: params.to, url: params.url, sentAt: new Date().toISOString() });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to send sign-in emails");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM ?? "Pulse Sydney Console <console@pulse.sydney>",
      to: params.to,
      subject: "Sign in to Pulse Sydney Console",
      html: `<p>Click the link below to sign in. It expires in 24 hours.</p><p><a href="${params.url}">${params.url}</a></p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send sign-in email: ${response.status} ${await response.text()}`);
  }
}
