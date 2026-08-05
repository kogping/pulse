// Minimal Node/Actions Sentry wiring for scripts/gtfs-import.ts's
// --check-staleness alarm (CLAUDE.md: the 10-day staleness check must fail
// "loudly (Sentry + workflow failure)"). There is no other Node/GitHub
// Actions Sentry usage in the repo — @sentry/nextjs inside apps/web and
// apps/console is a different SDK. Kept deliberately tiny: init only when
// SENTRY_DSN is set, so local/dry-run invocations stay silent.
import * as Sentry from "@sentry/node";
import { scrubPii } from "@pulse/analytics";

let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({
    dsn,
    environment: "github-actions",
    beforeSend: (event) => scrubPii(event),
    beforeBreadcrumb: (breadcrumb) => scrubPii(breadcrumb),
  });
  initialized = true;
}

export function captureStalenessAlarm(staleSources: readonly string[]): void {
  if (!initialized) return;
  Sentry.captureMessage(`GTFS static timetable stale for: ${staleSources.join(", ")}`, "fatal");
}

// A Node script exits before Sentry's transport has flushed its queue
// unless this is awaited first — unlike the Next.js SDK, which has its own
// lifecycle hooks to do this automatically.
export async function flushSentry(): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(2000);
}
