import * as Sentry from "@sentry/nextjs";
import { scrubPii } from "@pulse/analytics";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  // CLAUDE.md: no coordinates, no email in breadcrumbs.
  beforeSend: (event) => scrubPii(event),
  beforeBreadcrumb: (breadcrumb) => scrubPii(breadcrumb),
});
