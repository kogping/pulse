import type { EventName, EventPayloads } from "./events";
import { sanitizePayload } from "./sanitize";
import { recordEvent } from "./store";

// Events with `undefined` payloads take no second argument; events with a
// payload type require one. This is what makes `track("feed_rendered")`
// (missing the required payload) a type error instead of an undefined at
// runtime.
type TrackArgs<E extends EventName> = EventPayloads[E] extends undefined
  ? [event: E]
  : [event: E, payload: EventPayloads[E]];

export function track<E extends EventName>(...args: TrackArgs<E>): void {
  const [event, rawPayload] = args as [E, EventPayloads[E] | undefined];
  const payload = (
    rawPayload && typeof rawPayload === "object"
      ? sanitizePayload(rawPayload as Record<string, unknown>)
      : rawPayload
  ) as EventPayloads[E];

  recordEvent({ event, payload, timestamp: Date.now() });

  if (process.env.NODE_ENV !== "production") {
    console.debug(`[@pulse/analytics] ${event}`, payload ?? "");
  }
}
