"use client";

import { useState } from "react";
import { track } from "@pulse/analytics";

// F1.1's out-of-coverage branch. Coordinates that triggered this screen are
// never plumbed in here — only a suburb the visitor types themselves, so
// what gets stored (and what out_of_coverage_email_captured carries) is
// never derived from their exact location (CLAUDE.md invariant 6).
export function OutOfCoverageScreen() {
  const [email, setEmail] = useState("");
  const [suburb, setSuburb] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    try {
      const response = await fetch("/api/out-of-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, suburb }),
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      track("out_of_coverage_email_captured");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg bg-ink-700 px-6 py-10 text-center"
        data-testid="out-of-coverage-done"
      >
        <p className="text-lg font-semibold text-ink-50">You're on the list</p>
        <p className="text-sm text-ink-100">We'll email you when Pulse launches near {suburb}.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-ink-700 px-6 py-10 text-center" data-testid="out-of-coverage-screen">
      <p className="text-lg font-semibold text-ink-50">Not in your area yet</p>
      <p className="text-sm text-ink-100">
        Pulse doesn't cover your area yet. Leave your email and suburb and we'll let you know when it does.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
        <input
          type="text"
          required
          placeholder="Suburb"
          value={suburb}
          onChange={(event) => setSuburb(event.target.value)}
          className="min-h-touch rounded-lg bg-ink-900 px-4 text-base text-ink-50"
          aria-label="Suburb"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-touch rounded-lg bg-ink-900 px-4 text-base text-ink-50"
          aria-label="Email"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="min-h-touch rounded-full bg-accent-subtle px-4 text-sm font-medium text-ink-950 disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Notify me"}
        </button>
        {status === "error" ? <p className="text-sm text-red-400">Something went wrong — try again.</p> : null}
      </form>
    </div>
  );
}
