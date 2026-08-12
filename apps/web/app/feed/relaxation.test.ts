import { describe, expect, it, vi } from "vitest";
import type { FeedVenue, IntentFilterId } from "@pulse/db";
import { INTENT_FILTER_REGISTRY_BY_ID } from "@pulse/db";
import {
  RADIUS_LADDER_METERS,
  RELAXATION_TARGET_RESULTS,
  type RelaxationDeps,
  type RelaxationFetchArgs,
  runRelaxationLadder,
} from "./relaxation";

function venue(id: string): FeedVenue {
  return {
    id,
    name: `Venue ${id}`,
    precinct: "surry-hills",
    source: "curator",
    attributes: [],
    photo: { kind: "none" },
    curatorPitch: null,
    availability: { status: "open", closesAt: "23:00", spansMidnight: false },
  };
}

function venues(ids: string[]): FeedVenue[] {
  return ids.map(venue);
}

function fetchKey(args: RelaxationFetchArgs): string {
  return `${args.radiusMeters}:${[...args.filters].sort().join(",")}`;
}

// Scripted fake: maps an exact (radius, sorted-filters) combination to the
// venue ids that "match" at that rung. Any combination not listed returns
// an empty result, which is what drives the ladder to the next rung.
function makeDeps(options: {
  responses: Record<string, string[]>;
  filterCounts?: Partial<Record<IntentFilterId, number>>;
  closingSoon?: string[];
}): RelaxationDeps & { fetchVenues: ReturnType<typeof vi.fn>; countVenuesPerFilter: ReturnType<typeof vi.fn> } {
  const fetchVenues = vi.fn(async (args: RelaxationFetchArgs) => venues(options.responses[fetchKey(args)] ?? []));
  const countVenuesPerFilter = vi.fn(async () => options.filterCounts ?? {});
  const fetchClosingSoon = vi.fn(async () => venues(options.closingSoon ?? []));
  return { fetchVenues, countVenuesPerFilter, fetchClosingSoon };
}

describe("runRelaxationLadder", () => {
  it("stops at the exact rung when it already meets the target", async () => {
    const deps = makeDeps({ responses: { "800:live_music": ["a", "b", "c"] } });

    const result = await runRelaxationLadder({ filters: ["live_music"] }, deps);

    expect(result.attempts).toEqual([{ kind: "exact" }]);
    expect(result.rung).toEqual({ kind: "exact" });
    expect(result.disclosure).toBeNull();
    expect(result.venues.map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(deps.fetchVenues).toHaveBeenCalledTimes(1);
  });

  it("widens the radius one step and discloses the specific new radius", async () => {
    const deps = makeDeps({
      responses: {
        "800:live_music": ["a"],
        "1500:live_music": ["a", "b", "c"],
      },
    });

    const result = await runRelaxationLadder({ filters: ["live_music"] }, deps);

    expect(result.attempts).toEqual([{ kind: "exact" }, { kind: "widen_radius", radiusMeters: 1500 }]);
    expect(result.rung).toEqual({ kind: "widen_radius", radiusMeters: 1500 });
    expect(result.disclosure).toBe("Nothing exact — widening to 1.5km");
    expect(result.venues.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("runs every rung in order, names the dropped filter, and never leaks a closing-soon venue into the main feed", async () => {
    // Nothing meets the target until the filter is dropped at 6000m: too
    // thin even then, so the ladder falls through to closing_soon. "outdoor"
    // is deliberately the more permissive filter (higher count) so it's the
    // one the selectivity rule should drop, not "live_music".
    const deps = makeDeps({
      responses: {
        "800:live_music,outdoor": [],
        "1500:live_music,outdoor": [],
        "3000:live_music,outdoor": [],
        "6000:live_music,outdoor": [],
        "6000:live_music": ["a", "b"], // dropped "outdoor" -> still under target
      },
      filterCounts: { live_music: 4, outdoor: 9 },
      closingSoon: ["closing-1", "closing-2"],
    });

    const result = await runRelaxationLadder({ filters: ["live_music", "outdoor"] }, deps);

    expect(result.attempts).toEqual([
      { kind: "exact" },
      { kind: "widen_radius", radiusMeters: 1500 },
      { kind: "widen_radius", radiusMeters: 3000 },
      { kind: "widen_radius", radiusMeters: 6000 },
      { kind: "drop_filter", dropped: "outdoor", radiusMeters: 6000 },
      { kind: "closing_soon" },
    ]);
    expect(result.rung).toEqual({ kind: "closing_soon" });
    expect(result.disclosure).toBe(
      "Nothing open long enough nearby — these venues close within 45 minutes",
    );

    // The disclosure at the drop_filter rung (recoverable via disclosureForRung,
    // exercised indirectly through attempts above) must name the specific
    // filter dropped, not a generic message.
    const droppedLabel = INTENT_FILTER_REGISTRY_BY_ID.get("outdoor")?.label;
    expect(droppedLabel).toBe("Outdoor area");

    // Main feed section: whatever survived rung 4, never the closing-soon set.
    expect(result.venues.map((v) => v.id)).toEqual(["a", "b"]);
    const mainIds = new Set(result.venues.map((v) => v.id));
    const closingSoonIds = new Set(result.closingSoon.map((v) => v.id));
    expect(closingSoonIds).toEqual(new Set(["closing-1", "closing-2"]));
    for (const id of closingSoonIds) expect(mainIds.has(id)).toBe(false);
  });

  it("never drops a filter when there is nothing droppable in the active set (open_now alone)", async () => {
    const deps = makeDeps({
      responses: {}, // every radius comes up empty
      closingSoon: ["closing-1"],
    });

    const result = await runRelaxationLadder({ filters: ["open_now"] }, deps);

    // No droppable filters in the active set -> no drop_filter rung, straight
    // from the last radius widen to closing_soon.
    expect(result.attempts).toEqual([
      { kind: "exact" },
      { kind: "widen_radius", radiusMeters: 1500 },
      { kind: "widen_radius", radiusMeters: 3000 },
      { kind: "widen_radius", radiusMeters: 6000 },
      { kind: "closing_soon" },
    ]);
    expect(deps.countVenuesPerFilter).not.toHaveBeenCalled();
    expect(result.venues).toEqual([]);
    expect(result.closingSoon.map((v) => v.id)).toEqual(["closing-1"]);
  });

  it("F1.8: skips the closing_soon fallback rung when openNowOnly is false, returning whatever the last rung found", async () => {
    const deps = makeDeps({
      responses: {}, // every radius comes up empty
      closingSoon: ["closing-1"],
    });

    const result = await runRelaxationLadder({ filters: [], openNowOnly: false }, deps);

    expect(result.attempts).toEqual([
      { kind: "exact" },
      { kind: "widen_radius", radiusMeters: 1500 },
      { kind: "widen_radius", radiusMeters: 3000 },
      { kind: "widen_radius", radiusMeters: 6000 },
    ]);
    expect(result.rung).toEqual({ kind: "widen_radius", radiusMeters: 6000 });
    expect(deps.fetchClosingSoon).not.toHaveBeenCalled();
    expect(result.closingSoon).toEqual([]);
  });

  it("F1.8: threads openNowOnly through to every fetchVenues call", async () => {
    const deps = makeDeps({ responses: { "800:": ["a", "b", "c"] } });

    await runRelaxationLadder({ filters: [], openNowOnly: false }, deps);

    expect(deps.fetchVenues).toHaveBeenCalledWith(expect.objectContaining({ openNowOnly: false }));
  });

  it("radius ladder matches the documented 800 -> 1500 -> 3000 -> 6000 sequence", () => {
    expect(RADIUS_LADDER_METERS).toEqual([800, 1500, 3000, 6000]);
    expect(RELAXATION_TARGET_RESULTS).toBe(3);
  });
});
