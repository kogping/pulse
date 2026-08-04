import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FEED_CLOSING_BUFFER_MINUTES, isOpenWithBuffer, type VenueHoursInput } from "./feed";

// F1.1-F1.4: no venue the feed returns may be closed, or so close to
// closing that the badge would be stale before a visitor arrives.
// isOpenWithBuffer (feed.ts) is the pure predicate the SQL query mirrors;
// this file property-tests it directly since it has no DB dependency.

const SYDNEY_TZ = "Australia/Sydney";
const WEEK_MINUTES = 7 * 1440;

// Deliberately re-implemented rather than imported from feed.ts, using a
// different algorithm (a single week-relative window check with wraparound,
// instead of feed.ts's today/yesterday branch split) so this test can catch
// bugs in either the Sydney-time conversion or the day-rollover logic under
// test, not just re-assert whatever feed.ts already computes.
function referenceLocalParts(date: Date): { dayOfWeek: number; minutesOfDay: number } {
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
  if (dayOfWeek === undefined) throw new Error(`unrecognised weekday "${byType.weekday}"`);
  const hour = Number(byType.hour) % 24;
  return { dayOfWeek, minutesOfDay: hour * 60 + Number(byType.minute) + Number(byType.second) / 60 };
}

function referenceTimeToMinutes(time: string): number {
  const [h = "0", m = "0", s = "0"] = time.split(":");
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

function referenceIsOpenWithBuffer(hours: readonly VenueHoursInput[], now: Date, bufferMinutes: number): boolean {
  const { dayOfWeek: todayDow, minutesOfDay } = referenceLocalParts(now);
  const nowWeekMinutes = todayDow * 1440 + minutesOfDay;

  for (const row of hours) {
    if (row.isClosed || row.opensAt === null || row.closesAt === null) continue;
    const opensMin = referenceTimeToMinutes(row.opensAt);
    const closesMin = referenceTimeToMinutes(row.closesAt);
    const spansMidnight = closesMin <= opensMin;
    const openWeekMinutes = row.dayOfWeek * 1440 + opensMin;
    const closeWeekMinutes = row.dayOfWeek * 1440 + (spansMidnight ? closesMin + 1440 : closesMin);

    // The shift's week-relative window may fall in the previous or next
    // 7-day cycle relative to `now` (e.g. a Saturday-night shift observed
    // early Sunday morning) — the week is circular, so check all three.
    for (const offset of [-WEEK_MINUTES, 0, WEEK_MINUTES]) {
      const open = openWeekMinutes + offset;
      const close = closeWeekMinutes + offset;
      if (nowWeekMinutes >= open && nowWeekMinutes + bufferMinutes < close) return true;
    }
  }
  return false;
}

function timeArb() {
  return fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
}

// Every day of the week is either closed (represents both a routine closed
// day and a one-off public-holiday closure — the schema has no separate
// holiday table, so a holiday is modeled the same way any other closed day
// is), open with null hours (data-incomplete row), or open with a random
// opens/closes pair that may or may not span midnight.
function hoursRowArb(dayOfWeek: number) {
  return fc.oneof(
    fc.record({
      dayOfWeek: fc.constant(dayOfWeek),
      isClosed: fc.constant(true),
      opensAt: fc.constant(null),
      closesAt: fc.constant(null),
    }),
    fc.record({
      dayOfWeek: fc.constant(dayOfWeek),
      isClosed: fc.constant(false),
      opensAt: fc.constant(null),
      closesAt: fc.constant(null),
    }),
    fc.record({
      dayOfWeek: fc.constant(dayOfWeek),
      isClosed: fc.constant(false),
      opensAt: timeArb(),
      closesAt: timeArb(),
    }),
  );
}

const hoursArb: fc.Arbitrary<VenueHoursInput[]> = fc
  .tuple(...[0, 1, 2, 3, 4, 5, 6].map((d) => hoursRowArb(d)))
  .map((rows) => [...rows]);

// Spans several Australia/Sydney DST transitions (2024-2027 each have one
// in April and one in October) so generated `now` values land on both
// sides of a clock shift, not just on ordinary nights.
const nowArb = fc.date({
  min: new Date("2024-01-01T00:00:00Z"),
  max: new Date("2027-12-31T23:59:59Z"),
  noInvalidDate: true,
});

describe("feed-exclusion: isOpenWithBuffer", () => {
  it("agrees with an independently-implemented reference across generated (hours, now) pairs (>=1000 cases)", () => {
    fc.assert(
      fc.property(hoursArb, nowArb, (hours, now) => {
        const actual = isOpenWithBuffer(hours, now, FEED_CLOSING_BUFFER_MINUTES);
        const expected = referenceIsOpenWithBuffer(hours, now, FEED_CLOSING_BUFFER_MINUTES);
        expect(actual).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it("never returns true for a venue that closes within 45 minutes or is closed (>=1000 cases)", () => {
    fc.assert(
      fc.property(hoursArb, nowArb, (hours, now) => {
        if (!isOpenWithBuffer(hours, now, FEED_CLOSING_BUFFER_MINUTES)) return;

        const { dayOfWeek: todayDow, minutesOfDay: nowMinutes } = referenceLocalParts(now);
        const yesterdayDow = (todayDow + 6) % 7;

        const witnessed = hours.some((row) => {
          if (row.isClosed || row.opensAt === null || row.closesAt === null) return false;
          if (row.dayOfWeek !== todayDow && row.dayOfWeek !== yesterdayDow) return false;

          const opensMin = referenceTimeToMinutes(row.opensAt);
          const closesMin = referenceTimeToMinutes(row.closesAt);
          const spansMidnight = closesMin <= opensMin;

          if (row.dayOfWeek === todayDow) {
            const closingMinutes = spansMidnight ? closesMin + 1440 : closesMin;
            if (nowMinutes >= opensMin && nowMinutes + FEED_CLOSING_BUFFER_MINUTES < closingMinutes) return true;
          }
          if (spansMidnight && row.dayOfWeek === yesterdayDow) {
            if (nowMinutes + FEED_CLOSING_BUFFER_MINUTES < closesMin) return true;
          }
          return false;
        });

        expect(witnessed).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("excludes a post-midnight shift that closes within the buffer", () => {
    // Opens 22:00, closes 03:00 next day — at 02:30 there's only 30
    // minutes left, under the 45-minute buffer.
    const hours: VenueHoursInput[] = [{ dayOfWeek: 5, opensAt: "22:00:00", closesAt: "03:00:00", isClosed: false }];
    const now = sydneyInstant(2026, 1, 17, 2, 30); // a Saturday morning (Fri shift dayOfWeek=5)
    expect(isOpenWithBuffer(hours, now)).toBe(false);
  });

  it("includes a post-midnight shift with comfortable buffer remaining", () => {
    const hours: VenueHoursInput[] = [{ dayOfWeek: 5, opensAt: "22:00:00", closesAt: "03:00:00", isClosed: false }];
    const now = sydneyInstant(2026, 1, 17, 1, 30); // 90 minutes to close
    expect(isOpenWithBuffer(hours, now)).toBe(true);
  });

  it("is correct either side of the 2026 Sydney daylight-saving transitions", () => {
    // DST ends (clocks back 1h) 2026-04-05 03:00 -> 02:00 AEDT->AEST.
    const dstEndHours: VenueHoursInput[] = [
      { dayOfWeek: 6, opensAt: "22:00:00", closesAt: "04:00:00", isClosed: false }, // Saturday night
    ];
    expect(isOpenWithBuffer(dstEndHours, sydneyInstant(2026, 4, 5, 3, 0))).toBe(true);

    // DST starts (clocks forward 1h) 2026-10-04 02:00 -> 03:00 AEST->AEDT.
    const dstStartHours: VenueHoursInput[] = [
      { dayOfWeek: 6, opensAt: "22:00:00", closesAt: "05:00:00", isClosed: false }, // Saturday night
    ];
    // 90 minutes to close post-transition — comfortably open.
    expect(isOpenWithBuffer(dstStartHours, sydneyInstant(2026, 10, 4, 3, 30))).toBe(true);
    // 40 minutes to close post-transition — under the buffer, excluded.
    expect(isOpenWithBuffer(dstStartHours, sydneyInstant(2026, 10, 4, 4, 20))).toBe(false);
  });
});

// Builds a UTC instant for a given Sydney wall-clock date/time by asking
// Intl what the offset is near that instant and correcting for it —
// avoids hardcoding AEST/AEDT offsets in test fixtures.
function sydneyInstant(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naiveUtcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: SYDNEY_TZ,
    timeZoneName: "shortOffset",
  })
    .formatToParts(naiveUtcGuess)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = offsetPart?.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offsetHours = match ? Number(match[1]) : 10;
  const offsetMinutes = match?.[2] ? Number(match[2]) * Math.sign(offsetHours || 1) : 0;
  return new Date(naiveUtcGuess.getTime() - (offsetHours * 60 + offsetMinutes) * 60_000);
}
