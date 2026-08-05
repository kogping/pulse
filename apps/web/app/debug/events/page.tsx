import { notFound } from "next/navigation";
import { EventsDebugView } from "./events-debug-view";

export default function DebugEventsPage() {
  // FEED_TEST_MODE is only ever set for the e2e webServer process (never on
  // Vercel — see playwright.config.ts), which itself runs a production
  // build (installability/service-worker behavior is what actually ships).
  // Without this carve-out this page 404s for the entire e2e suite, since
  // NODE_ENV is "production" there too, and nothing could ever assert on a
  // fired analytics event (e.g. directions.spec.ts).
  if (process.env.NODE_ENV === "production" && process.env.FEED_TEST_MODE !== "1") {
    notFound();
  }

  return <EventsDebugView />;
}
