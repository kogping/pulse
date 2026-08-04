// Invariant (CLAUDE.md §6, no precise location persistence): analytics
// payloads must never carry raw coordinates. This pattern is intentionally
// broad (it also catches e.g. "relatedVenueId") — over-dropping a field is
// recoverable by renaming it; leaking a coordinate into an analytics vendor
// is not.
export const FORBIDDEN_KEY_PATTERN = /lat|lng|latitude|longitude|coords/i;

export function sanitizePayload<T extends Record<string, unknown>>(payload: T): Partial<T> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[@pulse/analytics] dropped "${key}" from track() payload — matches location-PII pattern`,
        );
      }
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized as Partial<T>;
}
