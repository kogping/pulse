import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LoadFeedResult } from "./feed/load-feed";

const verifiedBy = { curatorId: "c1", name: "Alex", tier: "senior" };

function relaxationResult(overrides: Partial<LoadFeedResult> = {}): LoadFeedResult {
  return {
    venues: [
      {
        id: "v1",
        name: "The Lansdowne",
        precinct: "Chippendale",
        source: "curator",
        attributes: [
          { key: "cover_charge", value: "$15", confidence: "fresh", lastVerifiedAt: new Date(), verifiedBy },
          { key: "dress_code", confidence: "unconfirmed" },
          { key: "last_entry_tonight", value: "1:00 AM", confidence: "fresh", lastVerifiedAt: new Date(), verifiedBy },
        ],
        photo: { kind: "none" },
        curatorPitch: null,
        availability: { status: "open", closesAt: "23:00", spansMidnight: false },
      },
    ],
    closingSoon: [],
    rung: { kind: "exact" },
    disclosure: null,
    attempts: [{ kind: "exact" }],
    venueLocations: { v1: { lat: -33.8975, lng: 151.1795 } },
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
        rung: { kind: "widen_radius", radiusMeters: 1500 },
        disclosure: "Nothing exact — widening to 1.5km",
        attempts: [{ kind: "exact" }, { kind: "widen_radius", radiusMeters: 1500 }],
      }),
    );

    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve(RESOLVED_LOCATION) }));
    expect(html).toContain("widening to 1.5km");
  });

  it("renders closing-soon venues only in the labelled section below the fold, never the main feed", async () => {
    vi.mocked(loadFeed).mockResolvedValueOnce(
      relaxationResult({
        venues: [
          {
            id: "v1",
            name: "The Lansdowne",
            precinct: "Chippendale",
            source: "curator",
            attributes: [],
            photo: { kind: "none" },
            curatorPitch: null,
            availability: { status: "open", closesAt: "23:00", spansMidnight: false },
          },
        ],
        closingSoon: [
          {
            id: "v2",
            name: "Last Drinks Bar",
            precinct: "Chippendale",
            source: "curator",
            attributes: [],
            photo: { kind: "none" },
            curatorPitch: null,
            availability: { status: "open", closesAt: "23:00", spansMidnight: false },
          },
        ],
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

  it("passes the requested filters through to loadFeed, and defaults openNowOnly to true", async () => {
    await Home({ searchParams: Promise.resolve({ ...RESOLVED_LOCATION, filters: "live_music,no_cover" }) });
    expect(loadFeed).toHaveBeenCalledWith(
      expect.objectContaining({ filters: ["live_music", "no_cover"], openNowOnly: true }),
    );
  });

  it("F1.8: passes openNowOnly:false to loadFeed only when openNow=0 is explicitly requested", async () => {
    await Home({ searchParams: Promise.resolve({ ...RESOLVED_LOCATION, openNow: "0" }) });
    expect(loadFeed).toHaveBeenCalledWith(expect.objectContaining({ openNowOnly: false }));
  });

  it("F1.8: the Open now chip is a real toggle — selected by default, its href turns it off", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve(RESOLVED_LOCATION) }));
    expect(html).toMatch(/<a href="\/\?openNow=0"[^>]*aria-pressed="true"[^>]*>Open now<\/a>/);
  });

  it("F1.8: with openNow=0, closed venues render an availability label and the chip is unselected", async () => {
    vi.mocked(loadFeed).mockResolvedValueOnce(
      relaxationResult({
        venues: [
          {
            id: "v1",
            name: "The Lansdowne",
            precinct: "Chippendale",
            source: "curator",
            attributes: [],
            photo: { kind: "none" },
            curatorPitch: null,
            availability: { status: "closed", opensAt: "18:00" },
          },
        ],
      }),
    );

    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ ...RESOLVED_LOCATION, openNow: "0" }) }));
    expect(html).toContain("Closed — opens 6:00 PM");
    expect(html).toMatch(/<a href="\/"[^>]*aria-pressed="false"[^>]*>Open now<\/a>/);
  });
});
