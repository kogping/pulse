import { describe, expect, it, vi } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { ScheduledTransportState } from "@pulse/db";
import { getTransportForHub, type GetTransportForHubDeps, type TransportCacheClient } from "./get-transport-for-hub";
import { deriveDisplayState } from "./derive-display-state";
import type { TransportResponse } from "./types";

// F3's chaos suite (roadmap): in no case may a live countdown render when
// live data is missing, stale, or errored — CLAUDE.md invariant #5. Three
// server-side failure modes plus the client's own >90s backstop, which
// exists precisely so a bug in any of the layers above it (Redis, the
// route handler, a CDN) still can't produce a wrong countdown.

const HUB_ID = "hub-central";
const STOP_ID = "200060";
const NOW = new Date("2026-08-05T22:00:00+10:00");

class FakeRedis implements TransportCacheClient {
  private store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return this.store.has(key) ? (this.store.get(key) as T) : null;
  }
  async set(key: string, value: unknown): Promise<unknown> {
    this.store.set(key, value);
    return "OK";
  }
}

function encodeFeed(headerTimestampSeconds: number, tripUpdates: { routeId: string; stopId: string; departureEpochSeconds: number }[]): Uint8Array {
  const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
    header: { gtfsRealtimeVersion: "2.0", timestamp: headerTimestampSeconds },
    entity: tripUpdates.map((t, i) => ({
      id: `trip-${i}`,
      tripUpdate: {
        trip: { routeId: t.routeId },
        stopTimeUpdate: [{ stopId: t.stopId, departure: { time: t.departureEpochSeconds } }],
      },
    })),
  });
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(message).finish();
}

function scheduledFallback(): ScheduledTransportState {
  return {
    status: "scheduled",
    nextDeparture: { route: "T1", headsign: "Central", scheduledTime: "11:45 PM" },
    lastServiceTonight: { route: "T1", headsign: "Central", scheduledTime: "1:10 AM" },
  };
}

function baseDeps(overrides: Partial<GetTransportForHubDeps> = {}): GetTransportForHubDeps {
  return {
    redis: new FakeRedis(),
    fetchLiveFeed: vi.fn(async () => new Uint8Array()),
    getScheduledTransport: vi.fn(async () => scheduledFallback()),
    gtfsStopIds: new Set([STOP_ID]),
    walkSeconds: 240,
    now: NOW,
    ...overrides,
  };
}

describe("transport degradation", () => {
  it("shows the scheduled timetable when the GTFS-R endpoint returns a server error", async () => {
    const deps = baseDeps({
      fetchLiveFeed: vi.fn(async () => {
        throw new Error("GTFS-R request failed: HTTP 500");
      }),
    });

    const result = await getTransportForHub(HUB_ID, deps);

    expect(result.payload.mode).toBe("scheduled");
  });

  it("shows the scheduled timetable when the GTFS-R endpoint times out", async () => {
    const deps = baseDeps({
      fetchLiveFeed: vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    });

    const result = await getTransportForHub(HUB_ID, deps);

    expect(result.payload.mode).toBe("scheduled");
  });

  it("shows the scheduled timetable when the decoded feed's own timestamp is 10 minutes old", async () => {
    const tenMinutesAgoSeconds = Math.floor(NOW.getTime() / 1000) - 10 * 60;
    const buffer = encodeFeed(tenMinutesAgoSeconds, [
      { routeId: "T1", stopId: STOP_ID, departureEpochSeconds: Math.floor(NOW.getTime() / 1000) + 300 },
    ]);
    const deps = baseDeps({ fetchLiveFeed: vi.fn(async () => buffer) });

    const result = await getTransportForHub(HUB_ID, deps);

    // The HTTP call succeeded and decoded cleanly — this must not be
    // confused with the 500/timeout cases above, but a feed that hasn't
    // moved in 10 minutes is exactly as untrustworthy as one that errored.
    expect(result.payload.mode).toBe("scheduled");
  });

  it("never renders a live countdown once the client's own clock is more than 90s past fetchedAt", () => {
    const response: TransportResponse = {
      payload: {
        mode: "live",
        nextDeparture: { route: "T1", headsign: null, departsAt: new Date(NOW.getTime() + 5 * 60_000).toISOString() },
        lastServiceTonight: null,
        walkSeconds: 120,
      },
      fetchedAt: new Date(NOW.getTime() - 91_000).toISOString(),
    };

    const state = deriveDisplayState(response, NOW);

    expect(state.kind).not.toBe("live");
    expect(state.kind).toBe("scheduled");
  });

  it("still renders live within the 90s window", () => {
    const response: TransportResponse = {
      payload: {
        mode: "live",
        nextDeparture: { route: "T1", headsign: null, departsAt: new Date(NOW.getTime() + 5 * 60_000).toISOString() },
        lastServiceTonight: null,
        walkSeconds: 120,
      },
      fetchedAt: new Date(NOW.getTime() - 89_000).toISOString(),
    };

    const state = deriveDisplayState(response, NOW);

    expect(state.kind).toBe("live");
  });
});
