"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { curatorStore } from "@/lib/curator-store";

// Always the same wording regardless of outcome — no account enumeration.
const GENERIC_MESSAGE = "If that email is on our curator list, we've sent a sign-in link.";

export async function requestMagicLink(email: string): Promise<{ message: string }> {
  const normalized = email.trim().toLowerCase();
  const curator = await curatorStore.findByEmail(normalized);

  if (curator?.active) {
    try {
      await signIn("nodemailer", { email: normalized, redirect: false, redirectTo: "/queue" });
    } catch (error) {
      // Swallow: the response must not reveal whether sign-in succeeded,
      // failed the allow-list check, or hit a transient error.
      if (!(error instanceof AuthError)) throw error;
    }
  }

  return { message: GENERIC_MESSAGE };
}
