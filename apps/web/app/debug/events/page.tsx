import { notFound } from "next/navigation";
import { EventsDebugView } from "./events-debug-view";

export default function DebugEventsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <EventsDebugView />;
}
