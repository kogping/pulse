import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RelaxationResult } from "./feed/relaxation";

const verifiedBy = { curatorId: "c1", name: "Alex", tier: "senior" };

function relaxationResult(overrides: Partial<RelaxationResult> = {}): RelaxationResult {
  return {
    venues: [
      {
        id: "v1",
        name: "The Lansdowne",
        precinct: "Chippendale",
        attributes: [
          { key: "cover_charge", value: "$15", confidence: "fresh", lastVerifiedAt: new Date(), verifiedBy },
          { key: "dress_code", confidence: "unconfirmed" },
          { key: "last_entry_tonight", value: "1:00 AM", confidence: "fresh", lastVerifiedAt: new Date(), verifiedBy },
        ],
      },
    ],
    closingSoon: [],
    rung: { kind: "exact" },
    disclosure: null,
    attempts: [{ kind: "exact" }],
    ...overrides,
  };
}

vi.mock("@pulse/config", () => ({ getFlag: vi.fn(async () => false) }));
vi.mock("./feed/load-feed", () => ({ loadFeed: vi.fn() }));
// renderToStaticMarkup has no Next.js router context — LocationGate and
// PrecinctSwitcher only call useRouter() for client-side navigation
// (replace()), which these server-rendered-shell tests never trigger.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const { loadFeed } = await import("./feed/load-feed");
const { default: Home } = await import("./page");

// F1.1: precinct/lat/lng only ever arrive as resolved search params (see
// location/location-gate.tsx) — these tests exercise the page as if that
// resolution already happened.
const RESOLVED_LOCATION = { precinct: "Newtown", lat: "-33.8975", lng: "151.1795" };

describe("Home", () => {
  beforeEach(() => {
    vi.mocked(loadFeed).mockReset();
    vi.mocked(loadFeed).mockResolvedValue(relaxationResult());
  });

  it("renders the location gate instead of the feed when precinct/lat/lng are unresolved", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Pulse — what");
    expect(html).not.toContain("The Lansdowne");
    expect(loadFeed).not.toHaveBeenCalled();
  });

  it("renders the venue feed shell with the design system components", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve(RESOLVED_LOCATION) }));
    expect(html).toContain("Pulse — what");
    expect(html).toContain("The Lansdowne");
    expect(html).toContain("Open now");
    expect(html).toContain("scheduled, not live");
  });

  it("hides the accessible chip when accessibility_filter_enabled is off", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve(RESOLVED_LOCATION) }));
    expect(html).not.toContain("Wheelchair accessible");
  });

  it("renders the relaxation disclosure banner when the ladder had to widen", async () => {
    vi.mocked(loadFeed).mockResolvedValueOnce(
      relaxationResult({
        rung: { kind: "widen_radius", radiusMeters: 1200 },
        disclosure: "Nothing exact — widening to 1.2km",
        attempts: [{ kind: "exact" }, { kind: "widen_radius", radiusMeters: 1200 }],
      }),
    );

    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve(RESOLVED_LOCATION) }));
    expect(html).toContain("widening to 1.2km");
  });

  it("renders closing-soon venues only in the labelled section below the fold, never the main feed", async () => {
    vi.mocked(loadFeed).mockResolvedValueOnce(
      relaxationResult({
        venues: [{ id: "v1", name: "The Lansdowne", precinct: "Chippendale", attributes: [] }],
        closingSoon: [{ id: "v2", name: "Last Drinks Bar", precinct: "Chippendale", attributes: [] }],
        rung: { kind: "closing_soon" },
        disclosure: "Nothing open long enough nearby — these venues close within 45 minutes",
        attempts: [{ kind: "exact" }, { kind: "closing_soon" }],
      }),
    );

    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve(RESOLVED_LOCATION) }));
    expect(html).toContain("Closing soon");
    expect(html).toContain("Last Drinks Bar");
    expect(html.indexOf("Last Drinks Bar")).toBeGreaterThan(html.indexOf("The Lansdowne"));
  });

  it("passes the requested filters through to loadFeed, always including open_now", async () => {
    await Home({ searchParams: Promise.resolve({ ...RESOLVED_LOCATION, filters: "live_music,no_cover" }) });
    expect(loadFeed).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.arrayContaining(["live_music", "no_cover", "open_now"]) }),
    );
  });
});
