"use client";

import { track } from "@pulse/analytics";
import { useState } from "react";

export interface FlagControlProps {
  venueId: string;
  attributeKey: string;
}

type FlagState = "idle" | "open" | "reported";

// "This looks wrong" (F3.x). Tap opens an inline sheet with the attribute
// pre-selected (it's the only one this control is scoped to — no picker
// needed) and an optional reason, then reports optimistically: the button
// flips to "Reported — thanks" the instant Report is tapped, without
// waiting on the network. The server call can 200-and-not-write (rate
// limited) with zero visible difference — that's the point, see
// app/api/flag/route.ts.
export function FlagControl({ venueId, attributeKey }: FlagControlProps) {
  const [state, setState] = useState<FlagState>("idle");
  const [reason, setReason] = useState("");

  if (state === "reported") {
    return (
      <p className="text-xs text-ink-400" data-testid={`flag-status-${attributeKey}`}>
        Reported — thanks
      </p>
    );
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        className="self-start text-xs text-ink-400 underline"
        data-testid={`flag-attribute-${attributeKey}`}
        onClick={() => setState("open")}
      >
        This looks wrong
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-ink-700 p-3" data-testid="flag-sheet">
      <label className="text-xs text-ink-300" htmlFor={`flag-reason-${attributeKey}`}>
        What's wrong? (optional)
      </label>
      <textarea
        id={`flag-reason-${attributeKey}`}
        data-testid="flag-reason"
        className="rounded border border-ink-700 bg-transparent p-2 text-sm text-ink-100"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="text-sm text-ink-50"
          data-testid="flag-submit"
          onClick={() => {
            setState("reported");
            track("badge_flagged", { venueId, attributeKey });
            fetch("/api/flag", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ venueId, attributeKey, reason: reason.trim() || undefined }),
            }).catch(() => {
              // Optimistic UI never rolls back on a failed request — see
              // module comment. A dropped request just means this one tap
              // doesn't count; the tapper isn't told either way.
            });
          }}
        >
          Report
        </button>
        <button type="button" className="text-sm text-ink-400" onClick={() => setState("idle")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
