import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Countdown } from "./Countdown";

describe("Countdown", () => {
  it("renders a scheduled label with no numeric countdown when there is no live data", () => {
    const html = renderToStaticMarkup(<Countdown data={{ mode: "scheduled", label: "Last entry 1:00 AM" }} />);
    expect(html).toContain("Last entry 1:00 AM");
    expect(html).toContain("scheduled, not live");
  });

  it("renders a ticking value only in live mode", () => {
    const targetIso = new Date(Date.now() + 90 * 60_000).toISOString();
    const html = renderToStaticMarkup(<Countdown data={{ mode: "live", label: "Last entry", targetIso }} />);
    expect(html).toContain("Last entry");
    expect(html).toMatch(/1h [23]\d?m/);
    expect(html).not.toContain("scheduled, not live");
  });

  it("does not accept a targetIso without mode: live (compile-time guard)", () => {
    // @ts-expect-error - CountdownData is a discriminated union; a scheduled
    // entry must not be able to smuggle in a target time to count down to.
    const data: import("./Countdown").CountdownData = { mode: "scheduled", label: "x", targetIso: "2026-01-01" };
    expect(data).toBeDefined();
  });
});
