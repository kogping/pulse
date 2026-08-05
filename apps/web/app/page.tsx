import Link from "next/link";
import { EmptyState, FilterChip, VenueCard } from "@pulse/ui";
import {
  ATTRIBUTE_REGISTRY_BY_KEY,
  INTENT_FILTER_REGISTRY,
  parseIntentFilterIds,
  type AttributeView,
  type IntentFilterId,
  type VenueCardData,
} from "@pulse/db";
import { getFlag } from "@pulse/config";
import { FeedAnalytics } from "./feed/feed-analytics";
import { ListMapToggle } from "./feed/list-map-toggle";
import { loadFeed, type LoadFeedResult } from "./feed/load-feed";
import { LocationGate } from "./location/location-gate";
import { PrecinctSwitcher } from "./location/precinct-switcher";

function isLastEntry(attribute: AttributeView): boolean {
  return attribute.key === "last_entry_tonight";
}

function venueCardProps(venue: VenueCardData) {
  const lastEntry = venue.attributes.find(isLastEntry);
  const badgeAttributes = venue.attributes
    .filter((attribute) => !isLastEntry(attribute))
    .map((attribute) => ({
      label: ATTRIBUTE_REGISTRY_BY_KEY.get(attribute.key)?.label ?? attribute.key,
      attribute,
    }));

  return {
    name: venue.name,
    precinct: venue.precinct,
    attributes: badgeAttributes,
    lastEntry:
      lastEntry && lastEntry.confidence !== "unconfirmed"
        ? { mode: "scheduled" as const, label: `Last entry ${lastEntry.value}` }
        : undefined,
  };
}

// F1.5: the main feed's venues, as either a plain list or list+map, gated
// entirely on map_enabled — when the flag is off the toggle control (and
// mapbox-gl, via list-map-toggle.tsx's dynamic import) never renders at
// all, not merely a disabled button.
function renderVenueList(relaxation: LoadFeedResult, mapEnabled: boolean) {
  const list = (
    <div className="flex flex-col gap-4">
      {relaxation.venues.map((venue, index) => (
        <Link key={venue.id} href={`/venue/${venue.id}?position=${index}&source=feed`}>
          <VenueCard {...venueCardProps(venue)} />
        </Link>
      ))}
    </div>
  );

  if (!mapEnabled) return list;

  const pins = relaxation.venues
    .map((venue) => {
      const location = relaxation.venueLocations[venue.id];
      return location ? { id: venue.id, name: venue.name, lat: location.lat, lng: location.lng } : null;
    })
    .filter((pin) => pin !== null);

  return <ListMapToggle pins={pins}>{list}</ListMapToggle>;
}

// F1.6: the active set lives in the URL (as a comma-separated `filters`
// param) so a filtered feed is shareable and back/forward works without
// any client-side state.
function filterHref(active: readonly IntentFilterId[], toggled: IntentFilterId): string {
  const next = active.includes(toggled) ? active.filter((id) => id !== toggled) : [...active, toggled];
  return next.length > 0 ? `/?filters=${next.join(",")}` : "/";
}

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const filtersParam = typeof params.filters === "string" ? params.filters : undefined;
  const rawFilters = filtersParam ? filtersParam.split(",").filter(Boolean) : [];
  const requestedFilters = parseIntentFilterIds(rawFilters);

  // F1.1: precinct/lat/lng are resolved client-side (geolocation, the
  // remembered/picked precinct, or the picker) and land here as URL search
  // params — see location/location-gate.tsx. Until that resolution has
  // happened, there's nothing to feed loadFeed, so the page renders the
  // gate instead of a feed.
  const precinct = typeof params.precinct === "string" ? params.precinct : undefined;
  const lat = typeof params.lat === "string" ? Number(params.lat) : undefined;
  const lng = typeof params.lng === "string" ? Number(params.lng) : undefined;

  if (!precinct || lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t">
        <h1 className="pt-4 text-2xl font-semibold text-ink-50">Pulse — what's good tonight</h1>
        <LocationGate filtersParam={filtersParam} />
      </main>
    );
  }

  // The accessible chip is omitted from the page entirely when the flag is
  // off, not merely disabled — docs/runbook/kill-switches.md: "when off,
  // the filter control is hidden". Stripped from the active set too, so a
  // stale shared URL from before the flag was flipped off can't silently
  // re-enable it.
  const accessibilityEnabled = await getFlag("accessibility_filter_enabled");
  const activeFilters = accessibilityEnabled ? requestedFilters : requestedFilters.filter((id) => id !== "accessible");
  const visibleFilterDefs = INTENT_FILTER_REGISTRY.filter((def) => def.id !== "accessible" || accessibilityEnabled);

  // F1.5: `_mapEnabled` is a test-only override for map.spec.ts, honoured
  // only under FEED_TEST_MODE (same convention as loadFeed's `_testNow` —
  // see api/feed/route.ts) so an e2e run can assert the flag-off behaviour
  // without needing a real Edge Config write. Never reachable in prod.
  const mapEnabledOverride = typeof params._mapEnabled === "string" ? params._mapEnabled : undefined;
  const mapEnabled =
    process.env.FEED_TEST_MODE === "1" && mapEnabledOverride !== undefined
      ? mapEnabledOverride === "true"
      : await getFlag("map_enabled");

  // Same FEED_TEST_MODE-gated `_testNow` escape hatch as /api/feed (see
  // that route) — lets map.spec.ts render the populated feed deterministically
  // instead of depending on real wall-clock time matching seeded venue hours.
  const testNow = typeof params._testNow === "string" ? params._testNow : undefined;
  const now = testNow && process.env.FEED_TEST_MODE === "1" ? new Date(testNow) : undefined;

  const relaxation = await loadFeed({
    precinct,
    lat,
    lng,
    now,
    filters: [...activeFilters, "open_now"],
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t">
      <div className="flex items-center justify-between pt-4">
        <h1 className="text-2xl font-semibold text-ink-50">Pulse — what's good tonight</h1>
        <PrecinctSwitcher currentPrecinctName={precinct} filtersParam={filtersParam} />
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {visibleFilterDefs.map((def) =>
          def.id === "open_now" ? (
            <FilterChip key={def.id} label={def.label} selected />
          ) : (
            <FilterChip
              key={def.id}
              label={def.label}
              selected={activeFilters.includes(def.id)}
              href={filterHref(activeFilters, def.id)}
            />
          ),
        )}
      </div>

      {relaxation.disclosure ? (
        <p className="rounded-lg bg-ink-700 px-4 py-2 text-sm text-ink-100">{relaxation.disclosure}</p>
      ) : null}

      {relaxation.venues.length > 0 ? (
        renderVenueList(relaxation, mapEnabled)
      ) : (
        <EmptyState heading="Nothing nearby right now" body="Try clearing a filter or checking back later." />
      )}

      {relaxation.closingSoon.length > 0 ? (
        // Rendered only below the fold, only here, only when the ladder
        // reached the closing_soon rung — the 45-minute exclusion
        // (F1.1-F1.4) is never relaxed, so this is the one section allowed
        // to show a venue closing within 45 minutes, and it's always
        // explicitly labelled as such.
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink-100">Closing soon</h2>
          <div className="flex flex-col gap-4">
            {relaxation.closingSoon.map((venue, index) => (
              <Link key={venue.id} href={`/venue/${venue.id}?position=${index}&source=closing_soon`}>
                <VenueCard {...venueCardProps(venue)} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <FeedAnalytics
        precinct={precinct}
        filters={activeFilters}
        resultCount={relaxation.venues.length}
        attempts={relaxation.attempts}
      />
    </main>
  );
}
