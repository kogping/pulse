"use client";

import { useEffect, useState } from "react";

// A discriminated union, not an optional prop, because "we don't have live
// data" must be impossible to render as a ticking number (CLAUDE.md
// invariant #5: degrade honestly — a countdown that might be wrong is worse
// than no countdown). Callers cannot pass a targetIso without also
// asserting mode: "live".
export type CountdownData =
  | { mode: "live"; label: string; targetIso: string }
  | { mode: "scheduled"; label: string };

export interface CountdownProps {
  data: CountdownData;
}

function formatRemaining(targetIso: string, now: number): string {
  const remainingMs = new Date(targetIso).getTime() - now;
  if (remainingMs <= 0) return "now";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function Countdown({ data }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (data.mode !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [data.mode]);

  if (data.mode === "scheduled") {
    return (
      <p className="text-sm text-ink-300">
        {data.label} <span className="text-ink-100">— scheduled, not live</span>
      </p>
    );
  }

  return (
    <p className="text-sm text-ink-300">
      {data.label}{" "}
      <span className="font-mono text-lg text-ink-50" aria-live="polite">
        {formatRemaining(data.targetIso, now)}
      </span>
    </p>
  );
}
