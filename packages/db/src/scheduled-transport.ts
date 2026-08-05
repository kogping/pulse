import { and, eq, or, sql as drizzleSql } from "drizzle-orm";
import { db } from "./client";
import { scheduledDepartures } from "./schema/scheduled-departures";
import { formatClockTime } from "./venue-detail";

const SYDNEY_TZ = "Australia/Sydney";

// A departure on "tomorrow"'s calendar row still belongs to tonight's
// timetable up to this cutoff (matches the post-midnight normalization in
// scripts/lib/gtfs/parse.ts#normalizeGtfsTime, which folds anything up to
// 04:00 back onto the previous service day at import time — this is the
// read-side mirror of that same boundary).
const NIGHT_CUTOFF_MINUTES = 4 * 60;

// Standalone copy of feed.ts's sydneyParts (same duplication already noted
// in venue-detail.ts) — DST-correct Sydney day-of-week/minutes-of-day via
// Intl rather than hand-rolled offset rules.
function sydneyParts(date: Date): { dayOfWeek: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SYDNEY_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayIndex[byType.weekday ?? ""];
  if (dayOfWeek === undefined) throw new Error(`sydneyParts: unrecognised weekday "${byType.weekday}"`);

  const hour = Number(byType.hour) % 24;
  const minute = Number(byType.minute);
  const second = Number(byType.second);
  return { dayOfWeek, minutesOfDay: hour * 60 + minute + second / 60 };
}

function timeStringToMinutes(time: string): number {
  const [h = "0", m = "0", s = "0"] = time.split(":");
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

export interface ScheduledDepartureRow {
  route: string;
  headsign: string | null;
  dayOfWeek: number;
  scheduledTime: string;
}

export interface ScheduledDeparture {
  route: string;
  headsign: string | null;
  /** Sydney-local 12h clock string, e.g. "1:15 AM" — a fixed label, never a countdown (CLAUDE.md invariant #5). */
  scheduledTime: string;
}

// F3.4's three explicit rendered states. No bare "no data" case: a hub
// either has a next departure tonight, has already had its last one, or
// never runs this late at all — the transport slot always knows which.
export type ScheduledTransportState =
  | { status: "scheduled"; nextDeparture: ScheduledDeparture; lastServiceTonight: ScheduledDeparture }
  | { status: "missed_last_service"; lastServiceTonight: ScheduledDeparture }
  | { status: "no_service_after_close" };

// Pure core: resolves the static timetable rows already fetched for
// "tonight" (today's day-of-week, plus tomorrow's up to NIGHT_CUTOFF_MINUTES)
// against the current Sydney time-of-day. DB-free and unit-testable without
// Postgres — see scheduled-transport.test.ts.
export function resolveScheduledTransportState(
  rows: readonly ScheduledDepartureRow[],
  nowMinutes: number,
  todayDow: number,
): ScheduledTransportState {
  const withAbsoluteMinutes = rows.map((row) => ({
    row,
    absoluteMinutes: timeStringToMinutes(row.scheduledTime) + (row.dayOfWeek === todayDow ? 0 : 1440),
  }));

  if (withAbsoluteMinutes.length === 0) {
    return { status: "no_service_after_close" };
  }

  const toDeparture = (entry: (typeof withAbsoluteMinutes)[number]): ScheduledDeparture => ({
    route: entry.row.route,
    headsign: entry.row.headsign,
    scheduledTime: formatClockTime(entry.row.scheduledTime),
  });

  const last = withAbsoluteMinutes.reduce((best, e) => (e.absoluteMinutes > best.absoluteMinutes ? e : best));
  const future = withAbsoluteMinutes.filter((e) => e.absoluteMinutes >= nowMinutes);

  if (future.length === 0) {
    return { status: "missed_last_service", lastServiceTonight: toDeparture(last) };
  }

  const next = future.reduce((best, e) => (e.absoluteMinutes < best.absoluteMinutes ? e : best));
  return { status: "scheduled", nextDeparture: toDeparture(next), lastServiceTonight: toDeparture(last) };
}

// F3's scheduled fallback (CLAUDE.md invariant #5): read path over the
// static timetable scripts/gtfs-import.ts keeps current, entirely
// independent of the live GTFS-R feed — this must resolve correctly even
// when live data has never worked at all.
export async function getScheduledTransportForHub(hubId: string, now: Date = new Date()): Promise<ScheduledTransportState> {
  const { dayOfWeek: todayDow, minutesOfDay: nowMinutes } = sydneyParts(now);
  const tomorrowDow = (todayDow + 1) % 7;
  const nightCutoff = `${String(Math.floor(NIGHT_CUTOFF_MINUTES / 60)).padStart(2, "0")}:00:00`;

  const rows = await db
    .select({
      route: scheduledDepartures.route,
      headsign: scheduledDepartures.headsign,
      dayOfWeek: scheduledDepartures.dayOfWeek,
      scheduledTime: scheduledDepartures.scheduledTime,
    })
    .from(scheduledDepartures)
    .where(
      and(
        eq(scheduledDepartures.transitHubId, hubId),
        or(
          eq(scheduledDepartures.dayOfWeek, todayDow),
          and(eq(scheduledDepartures.dayOfWeek, tomorrowDow), drizzleSql`${scheduledDepartures.scheduledTime} <= ${nightCutoff}`),
        ),
      ),
    );

  return resolveScheduledTransportState(rows, nowMinutes, todayDow);
}
