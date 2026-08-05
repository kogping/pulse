import { describe, expect, it } from "vitest";
import { resolveScheduledTransportState, type ScheduledDepartureRow } from "./scheduled-transport";

const FRIDAY = 5;
const SATURDAY = 6;

function row(overrides: Partial<ScheduledDepartureRow>): ScheduledDepartureRow {
  return { route: "T1", headsign: "Central", dayOfWeek: FRIDAY, scheduledTime: "23:00:00", ...overrides };
}

describe("resolveScheduledTransportState", () => {
  it("returns no_service_after_close when the hub has no rows for tonight", () => {
    const state = resolveScheduledTransportState([], 22 * 60, FRIDAY);
    expect(state).toEqual({ status: "no_service_after_close" });
  });

  it("returns scheduled with the next departure and the last service of the night", () => {
    const rows = [
      row({ route: "T1", scheduledTime: "22:30:00" }),
      row({ route: "T2", scheduledTime: "23:15:00" }),
      row({ route: "T3", dayOfWeek: SATURDAY, scheduledTime: "01:10:00" }),
    ];
    const state = resolveScheduledTransportState(rows, 23 * 60, FRIDAY);

    expect(state.status).toBe("scheduled");
    if (state.status !== "scheduled") throw new Error("unreachable");
    expect(state.nextDeparture.route).toBe("T2");
    expect(state.nextDeparture.scheduledTime).toBe("11:15 PM");
    expect(state.lastServiceTonight.route).toBe("T3");
    expect(state.lastServiceTonight.scheduledTime).toBe("1:10 AM");
  });

  it("returns missed_last_service once now is past every departure tonight", () => {
    const rows = [row({ route: "T1", scheduledTime: "21:00:00" }), row({ route: "T2", scheduledTime: "22:00:00" })];
    // 11pm Friday — past both.
    const state = resolveScheduledTransportState(rows, 23 * 60, FRIDAY);

    expect(state).toEqual({
      status: "missed_last_service",
      lastServiceTonight: { route: "T2", headsign: "Central", scheduledTime: "10:00 PM" },
    });
  });
});
