import type { ScheduledTransportState } from "@pulse/db";
import { decodeLiveFeed } from "./gtfsr-decode";
import type { TransportPayload, TransportResponse } from "./types";

// Read-through cache TTL: a fresh cache hit never calls TfNSW at all.
export const TRANSPORT_CACHE_TTL_SECONDS = 30;
// A cached (or freshly decoded) live payload older than this is not served
// as live — it falls back to the scheduled timetable instead. Matches the
// client-side >90s rule (transport-countdown.tsx) so the two layers agree
// on what counts as stale rather than each guessing independently.
const STALE_THRESHOLD_MS = 90_000;

export interface TransportCacheClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
}

export interface GetTransportForHubDeps {
  redis: TransportCacheClient;
  /** Throws (network error, non-2xx, AbortError on timeout) rather than returning an error payload — callers of this dep are never handed a "bad" buffer to decode. */
  fetchLiveFeed: () => Promise<Uint8Array>;
  getScheduledTransport: (now: Date) => Promise<ScheduledTransportState>;
  gtfsStopIds: ReadonlySet<string>;
  walkSeconds: number;
  now?: Date;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

function cacheKey(hubId: string): string {
  return `transport:${hubId}`;
}

function scheduledStateToPayload(state: ScheduledTransportState, walkSeconds: number): TransportPayload {
  switch (state.status) {
    case "scheduled":
      return { mode: "scheduled", nextDeparture: state.nextDeparture, lastServiceTonight: state.lastServiceTonight, walkSeconds };
    case "missed_last_service":
      return { mode: "missed_last_service", lastServiceTonight: state.lastServiceTonight, walkSeconds };
    case "no_service_after_close":
      return { mode: "no_service_after_close", walkSeconds };
  }
}

async function buildScheduledResponse(deps: GetTransportForHubDeps, now: Date): Promise<TransportResponse> {
  const state = await deps.getScheduledTransport(now);
  return { payload: scheduledStateToPayload(state, deps.walkSeconds), fetchedAt: now.toISOString() };
}

async function writeCache(deps: GetTransportForHubDeps, hubId: string, response: TransportResponse): Promise<void> {
  try {
    await deps.redis.set(cacheKey(hubId), response, { ex: TRANSPORT_CACHE_TTL_SECONDS });
  } catch (error) {
    deps.logger?.warn("redis unreachable writing transport cache key", { hubId, error });
  }
}

// F3's read path: GET /api/transport/[hubId] minus the HTTP/flag/region
// wiring (see app/api/transport/[hubId]/route.ts). Degrades honestly at
// every failure boundary (CLAUDE.md invariant #5) — a Redis outage, a TfNSW
// 500/timeout, or a structurally-fine-but-stale feed all resolve to the
// scheduled timetable, never a guessed countdown. Deps-injected so every
// one of those boundaries is directly testable without real network or
// Upstash — see transport-degradation.test.ts.
export async function getTransportForHub(hubId: string, deps: GetTransportForHubDeps): Promise<TransportResponse> {
  const now = deps.now ?? new Date();

  let cached: TransportResponse | null = null;
  try {
    cached = await deps.redis.get<TransportResponse>(cacheKey(hubId));
  } catch (error) {
    deps.logger?.warn("redis unreachable reading transport cache key", { hubId, error });
  }

  if (cached) {
    const ageMs = now.getTime() - new Date(cached.fetchedAt).getTime();
    if (ageMs <= TRANSPORT_CACHE_TTL_SECONDS * 1000) {
      // Fresh cache hit — no TfNSW call at all, live or scheduled.
      return cached;
    }
  }

  let liveBuffer: Uint8Array;
  try {
    liveBuffer = await deps.fetchLiveFeed();
  } catch (error) {
    deps.logger?.warn("GTFS-R fetch failed; falling back to scheduled timetable", { hubId, error });
    // Stale-while-revalidate: a live fetch failure still gets to serve a
    // recently-cached live payload rather than reverting to scheduled —
    // but only within STALE_THRESHOLD_MS, otherwise the "recent" cache
    // would itself be the wrong-countdown case invariant #5 forbids.
    if (cached && cached.payload.mode === "live") {
      const ageMs = now.getTime() - new Date(cached.fetchedAt).getTime();
      if (ageMs <= STALE_THRESHOLD_MS) return cached;
    }
    const response = await buildScheduledResponse(deps, now);
    await writeCache(deps, hubId, response);
    return response;
  }

  const decoded = decodeLiveFeed(liveBuffer, deps.gtfsStopIds, now);
  const feedAgeMs = decoded.feedTimestampSeconds === null ? Infinity : now.getTime() - decoded.feedTimestampSeconds * 1000;

  if (decoded.nextDeparture === null || feedAgeMs > STALE_THRESHOLD_MS) {
    // Structurally valid response, but either nothing usable for this hub
    // or the upstream feed itself hasn't moved recently — same "don't
    // trust it" outcome as a hard failure.
    const response = await buildScheduledResponse(deps, now);
    await writeCache(deps, hubId, response);
    return response;
  }

  const scheduledState = await deps.getScheduledTransport(now);
  const lastServiceTonight = scheduledState.status === "no_service_after_close" ? null : scheduledState.lastServiceTonight;
  const response: TransportResponse = {
    payload: { mode: "live", nextDeparture: decoded.nextDeparture, lastServiceTonight, walkSeconds: deps.walkSeconds },
    fetchedAt: now.toISOString(),
  };
  await writeCache(deps, hubId, response);
  return response;
}
