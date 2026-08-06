import { describe, expect, it } from "vitest";
import { tonightAvailability, type VenueHoursInput } from "./feed";

// F1.8: tonightAvailability is the display-only sibling of isOpenWithBuffer
// (feed-exclusion.test.ts) — used only once a visitor toggles "Open now"
// off, so closed/unconfirmed-hours venues can appear labelled honestly.
// All fixtures are fixed AEST (+10:00, no DST in August) so dayOfWeek/time
// math is deterministic without an Australia/Sydney-aware test harness.

// Thursday = dayOfWeek 4, Wednesday = 3 (Sun=0..Sat=6).
const THURSDAY_9PM = new Date("2026-08-06T21:00:00+10:00");
const THURSDAY_3PM = new Date("2026-08-06T15:00:00+10:00");
const THURSDAY_1130PM = new Date("2026-08-06T23:30:00+10:00");
const THURSDAY_1AM = new Date("2026-08-06T01:00:00+10:00");

describe("tonightAvailability", () => {
  it("returns unknown for a venue with no hours rows at all", () => {
    expect(tonightAvailability([], THURSDAY_9PM)).toEqual({ status: "unknown" });
  });

  it("returns open with closesAt when within today's shift", () => {
    const hours: VenueHoursInput[] = [{ dayOfWeek: 4, isClosed: false, opensAt: "18:00", closesAt: "23:00" }];
    expect(tonightAvailability(hours, THURSDAY_9PM)).toEqual({ status: "open", closesAt: "23:00", spansMidnight: false });
  });

  it("returns closed with today's opensAt when the venue hasn't opened yet today", () => {
    const hours: VenueHoursInput[] = [{ dayOfWeek: 4, isClosed: false, opensAt: "18:00", closesAt: "23:00" }];
    expect(tonightAvailability(hours, THURSDAY_3PM)).toEqual({ status: "closed", opensAt: "18:00" });
  });

  it("returns closed with a null opensAt once today's shift has already ended, never guessing a future day", () => {
    const hours: VenueHoursInput[] = [{ dayOfWeek: 4, isClosed: false, opensAt: "18:00", closesAt: "23:00" }];
    expect(tonightAvailability(hours, THURSDAY_1130PM)).toEqual({ status: "closed", opensAt: null });
  });

  it("returns open via a past-midnight shift that started yesterday", () => {
    const hours: VenueHoursInput[] = [{ dayOfWeek: 3, isClosed: false, opensAt: "22:00", closesAt: "03:00" }];
    expect(tonightAvailability(hours, THURSDAY_1AM)).toEqual({ status: "open", closesAt: "03:00", spansMidnight: true });
  });

  it("treats an isClosed row as not open, even if opensAt/closesAt are set", () => {
    const hours: VenueHoursInput[] = [{ dayOfWeek: 4, isClosed: true, opensAt: "18:00", closesAt: "23:00" }];
    expect(tonightAvailability(hours, THURSDAY_9PM)).toEqual({ status: "closed", opensAt: null });
  });

  it("picks today's shift over an unrelated other day in the same hours list", () => {
    const hours: VenueHoursInput[] = [
      { dayOfWeek: 1, isClosed: false, opensAt: "18:00", closesAt: "23:00" },
      { dayOfWeek: 4, isClosed: false, opensAt: "17:00", closesAt: "22:00" },
    ];
    expect(tonightAvailability(hours, THURSDAY_9PM)).toEqual({ status: "open", closesAt: "22:00", spansMidnight: false });
  });
});
