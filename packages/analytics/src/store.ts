import type { EventName, EventPayloads } from "./events";

export interface TrackedEvent<E extends EventName = EventName> {
  event: E;
  payload: EventPayloads[E];
  timestamp: number;
}

const STORAGE_KEY = "pulse:debug-events";
const MAX_EVENTS = 50;
const EVENT_TYPE = "pulse:analytics-event";

// Browser-only, backed by localStorage rather than a module-level array: the
// /debug/events page is a separate client render tree from whatever fired
// the event, and localStorage is the one thing both sides can read without
// a server round trip.
export function recordEvent(entry: TrackedEvent): void {
  if (typeof window === "undefined") return;
  try {
    const next = [...readEvents(), entry].slice(-MAX_EVENTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: entry }));
  } catch {
    // localStorage unavailable (private mode, quota exceeded) — the debug
    // view just shows fewer events; tracking itself must never throw.
  }
}

export function readEvents(): TrackedEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackedEvent[]) : [];
  } catch {
    return [];
  }
}

export function subscribeToEvents(onEvent: (entry: TrackedEvent) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: Event) => onEvent((e as CustomEvent<TrackedEvent>).detail);
  window.addEventListener(EVENT_TYPE, handler);
  return () => window.removeEventListener(EVENT_TYPE, handler);
}
