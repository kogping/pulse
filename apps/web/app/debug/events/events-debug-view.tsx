"use client";

import { useEffect, useState } from "react";
import { readEvents, subscribeToEvents, type TrackedEvent } from "@pulse/analytics";

const MAX_EVENTS = 50;

export function EventsDebugView() {
  const [events, setEvents] = useState<TrackedEvent[]>([]);

  useEffect(() => {
    setEvents(readEvents());
    return subscribeToEvents((entry) => {
      setEvents((prev) => [...prev, entry].slice(-MAX_EVENTS));
    });
  }, []);

  const mostRecentFirst = [...events].reverse();

  return (
    <main>
      <h1>Last {events.length} tracked events</h1>
      {mostRecentFirst.length === 0 ? (
        <p>No events tracked yet in this browser.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {mostRecentFirst.map((entry, index) => (
              <tr key={`${entry.timestamp}-${index}`}>
                <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                <td>{entry.event}</td>
                <td>
                  <pre>{JSON.stringify(entry.payload ?? null)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
