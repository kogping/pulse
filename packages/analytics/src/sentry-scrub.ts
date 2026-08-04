// Shared PII scrubber for Sentry's beforeSend / beforeBreadcrumb hooks in
// both apps (CLAUDE.md: no coordinates, no email in breadcrumbs). Untyped
// against Sentry's event shape on purpose — this package doesn't otherwise
// depend on @sentry/nextjs, and the recursive walk works on any JSON-like
// value regardless of which SDK type it came from.
const COORD_KEY_PATTERN = /lat|lng|latitude|longitude|coords/i;
const EMAIL_KEY_PATTERN = /email/i;
const EMAIL_VALUE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

export function scrubPii<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => scrubPii(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (COORD_KEY_PATTERN.test(key) || EMAIL_KEY_PATTERN.test(key)) continue;
      out[key] = scrubPii(v);
    }
    return out as T;
  }
  if (typeof value === "string") {
    return value.replace(EMAIL_VALUE_PATTERN, "[redacted-email]") as unknown as T;
  }
  return value;
}
