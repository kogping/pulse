"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@pulse/analytics";
import { deriveDisplayState, type TransportDisplayState } from "../../../lib/transport/derive-display-state";
import type { TransportResponse } from "../../../lib/transport/types";
import { TFNSW_ATTRIBUTION } from "./tfnsw-attribution";

export interface TransportCountdownProps {
  hubId: string;
  hubName: string;
  walkSeconds: number;
}

// Server cache TTL is 30s (get-transport-for-hub.ts) — refetching any more
// often than that would only ever re-read the same Redis entry.
const REFETCH_INTERVAL_MS = 30_000;
const TICK_INTERVAL_MS = 1_000;

function formatWalk(walkSeconds: number): string {
  const minutes = Math.max(1, Math.round(walkSeconds / 60));
  return `${minutes} min walk`;
}

function formatCountdown(secondsUntilDeparture: number): string {
  if (secondsUntilDeparture < 60) return "now";
  const minutes = Math.round(secondsUntilDeparture / 60);
  return `${minutes} min`;
}

// transport_viewed's closed mode set (packages/analytics/src/events.ts) —
// missed/no-service both count as "none": there is no departure to show,
// live or otherwise.
function analyticsMode(kind: TransportDisplayState["kind"]): "live" | "scheduled" | "none" {
  if (kind === "live") return "live";
  if (kind === "scheduled") return "scheduled";
  return "none";
}

export function TransportCountdown({ hubId, hubName, walkSeconds }: TransportCountdownProps) {
  const [response, setResponse] = useState<TransportResponse | null>(null);
  const [now, setNow] = useState(() => new Date());
  const trackedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/transport/${hubId}?walkSeconds=${walkSeconds}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as TransportResponse;
        if (!cancelled) setResponse(data);
      } catch {
        // Network failure at the client fetch itself (not the GTFS-R fetch
        // inside the route, which already degrades server-side): leave the
        // last known response in place — a brief blip should not blank a
        // countdown that was showing a moment ago. Nothing to render if
        // there was never a successful response.
      }
    }

    load();
    const refetch = setInterval(load, REFETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(refetch);
    };
  }, [hubId, walkSeconds]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), TICK_INTERVAL_MS);
    return () => clearInterval(tick);
  }, []);

  if (!response) return null;

  const state = deriveDisplayState(response, now);

  if (!trackedRef.current) {
    trackedRef.current = true;
    track("transport_viewed", { mode: analyticsMode(state.kind) });
  }

  return (
    <section data-testid="transport-slot" className="flex flex-col gap-1 rounded-lg bg-ink-900 p-4">
      <p className="text-sm text-ink-300">{hubName}</p>

      {state.kind === "live" ? (
        <p className="text-base font-medium text-ink-50" data-testid="transport-live">
          Next {state.nextDeparture.route} in {formatCountdown(state.secondsUntilDeparture)} · {formatWalk(state.walkSeconds)}
        </p>
      ) : null}

      {state.kind === "scheduled" ? (
        <p className="text-base font-medium text-ink-50" data-testid="transport-scheduled">
          {state.nextDeparture
            ? `${state.nextDeparture.route} at ${state.nextDeparture.scheduledTime}`
            : "Live transport data unavailable"}{" "}
          · scheduled, not live · {formatWalk(state.walkSeconds)}
        </p>
      ) : null}

      {state.kind === "missed_last_service" ? (
        <p className="text-base font-medium text-ink-50" data-testid="transport-missed">
          You&rsquo;ve missed the last service ({state.lastServiceTonight.scheduledTime})
        </p>
      ) : null}

      {state.kind === "no_service_after_close" ? (
        <p className="text-base font-medium text-ink-50" data-testid="transport-no-service">
          No service after close
        </p>
      ) : null}

      <p className="text-xs text-ink-400">{TFNSW_ATTRIBUTION}</p>
    </section>
  );
}
