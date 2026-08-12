import Link from "next/link";
import { EmptyState, FilterChip, VenueCard } from "@pulse/ui";
import {
  ATTRIBUTE_REGISTRY_BY_KEY,
  INTENT_FILTER_REGISTRY,
  formatClockTime,
  parseIntentFilterIds,
  type AttributeView,
  type FeedVenue,
  type FeedVenueAvailability,
  type IntentFilterId,
} from "@pulse/db";
import { getFlag } from "@pulse/config";
import { formatDistance } from "./feed/distance";
import { FeedAnalytics } from "./feed/feed-analytics";
import { ListMapToggle } from "./feed/list-map-toggle";
import { loadFeed, type LoadFeedResult } from "./feed/load-feed";
import { LocationGate } from "./location/location-gate";
import { PrecinctSwitcher } from "./location/precinct-switcher";

function isLastEntry(attribute: AttributeView): boolean {
  return attribute.key === "last_entry_tonight";
}

// F1.8: only rendered once the visitor has toggled "Open now" off — with
// the default (openNowOnly:true) feed, every venue is guaranteed open, so
// this label would be redundant noise on every card. "closed" with a null
// opensAt renders bare "Closed" rather than guessing a reopening time — see
// tonightAvailability's doc comment (packages/db/src/feed.ts).
function availabilityLabel(availability: FeedVenueAvailability): string {
  switch (availability.status) {
    case "open":
      return `Open now — until ${formatClockTime(availability.closesAt)}`;
    case "closed":
      return availability.opensAt ? `Closed — opens ${formatClockTime(availability.opensAt)}` : "Closed";
    case "unknown":
      return "Hours unknown";
  }
}

function venueCardProps(
  venue: FeedVenue,
  openNowOnly: boolean,
  visitor: { lat: number; lng: number },
  venueLocations: Record<string, { lat: number; lng: number }>,
) {
  const lastEntry = venue.attributes.find(isLastEntry);
  const badgeAttributes = venue.attributes
    .filter((attribute) => !isLastEntry(attribute))
    .map((attribute) => ({
      label: ATTRIBUTE_REGISTRY_BY_KEY.get(attribute.key)?.label ?? attribute.key,
      attribute,
    }));

  const photo =
    venue.photo.kind === "curator"
      ? { src: venue.photo.url, attribution: null }
      : venue.photo.kind === "places"
        ? { src: `/api/venue-photo/${venue.id}`, attribution: venue.photo.attribution }
        : undefined;

  const venueLocation = venueLocations[venue.id];

  return {
    name: venue.name,
    precinct: venue.precinct,
    source: venue.source,
    attributes: badgeAttributes,
    lastEntry:
      lastEntry && lastEntry.confidence !== "unconfirmed"
        ? { mode: "scheduled" as const, label: `Last entry ${lastEntry.value}` }
        : undefined,
    photo,
    availabilityLabel: openNowOnly ? undefined : availabilityLabel(venue.availability),
    distanceLabel: venueLocation ? formatDistance(visitor, venueLocation) : undefined,
  };
}

// F1.5: the main feed's venues, as either a plain list or list+map, gated
// entirely on map_enabled — when the flag is off the toggle control (and
// mapbox-gl, via list-map-toggle.tsx's dynamic import) never renders at
// all, not merely a disabled button.
function renderVenueList(relaxation: LoadFeedResult, mapEnabled: boolean, openNowOnly: boolean, visitor: { lat: number; lng: number }) {
  const list = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {relaxation.venues.map((venue, index) => (
        <Link key={venue.id} href={`/venue/${venue.id}?position=${index}&source=feed`}>
          <VenueCard {...venueCardProps(venue, openNowOnly, visitor, relaxation.venueLocations)} />
        </Link>
      ))}
    </div>
  );

  if (!mapEnabled) return list;

  const pins = relaxation.venues
    .map((venue) => {
      const location = relaxation.venueLocations[venue.id];
      if (!location) return null;
      const photo =
        venue.photo.kind === "curator"
          ? { src: venue.photo.url, attribution: null }
          : venue.photo.kind === "places"
            ? { src: `/api/venue-photo/${venue.id}`, attribution: venue.photo.attribution }
            : undefined;
      return {
        id: venue.id,
        name: venue.name,
        lat: location.lat,
        lng: location.lng,
        photo,
        description: venue.curatorPitch,
        distanceLabel: formatDistance(visitor, location),
      };
    })
    .filter((pin) => pin !== null);

  return <ListMapToggle pins={pins}>{list}</ListMapToggle>;
}

// F1.6/F1.8: both the intent filters and the openNow toggle live in the URL
// (as a comma-separated `filters` param and a plain `openNow=0` flag) so a
// filtered/toggled feed is shareable and back/forward works without any
// client-side state. precinct/lat/lng are deliberately omitted — landing
// here without them just re-renders LocationGate, which restores them from
// the remembered precinct (see location/location-gate.tsx) and redirects.
// `precinctOnly` follows the same convention: it's the opt-in "this suburb
// only" restriction, separate from precinct/lat/lng (which only seed the
// ranking origin), so it survives filter/openNow toggles the same way.
function feedHref(filters: readonly IntentFilterId[], openNowOnly: boolean, precinctOnly: boolean): string {
  const params = new URLSearchParams();
  if (filters.length > 0) params.set("filters", filters.join(","));
  if (!openNowOnly) params.set("openNow", "0");
  if (precinctOnly) params.set("precinctOnly", "1");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function filterHref(active: readonly IntentFilterId[], toggled: IntentFilterId, openNowOnly: boolean, precinctOnly: boolean): string {
  const next = active.includes(toggled) ? active.filter((id) => id !== toggled) : [...active, toggled];
  return feedHref(next, openNowOnly, precinctOnly);
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

  // Opt-in "this suburb only" restriction — distinct from precinct/lat/lng
  // above, which only seed the ranking origin. Defaults off: absent this
  // param, the feed is always city-wide, whichever precinct got you here.
  const precinctOnlyParam = typeof params.precinctOnly === "string" ? params.precinctOnly : undefined;
  const precinctOnly = precinctOnlyParam === "1";

  if (!precinct || lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t">
        <h1 className="pt-4 text-2xl font-semibold text-ink-50">Pulse — what's good tonight</h1>
        <LocationGate filtersParam={filtersParam} precinctOnlyParam={precinctOnlyParam} />
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

  // F1.8: "Open now" defaults on (F1.1-F1.4's existing behaviour) — only
  // `openNow=0` turns it off. Anything else in the param (missing, "1",
  // garbage) is treated as "on", so a malformed/stale link degrades to the
  // safer default rather than silently showing closed venues.
  const openNowParam = typeof params.openNow === "string" ? params.openNow : undefined;
  const openNowOnly = openNowParam !== "0";

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
    filters: activeFilters,
    openNowOnly,
    precinctFilter: precinctOnly ? precinct : undefined,
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t sm:max-w-3xl lg:max-w-5xl">
      <div className="flex items-center justify-between pt-4">
        <h1 className="text-2xl font-semibold text-ink-50">Pulse — what's good tonight</h1>
        <PrecinctSwitcher currentPrecinctName={precinct} filtersParam={filtersParam} precinctOnlyParam={precinctOnlyParam} />
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {/* Distinct from PrecinctSwitcher: that picks *which* suburb seeds
            the ranking origin, this chip decides whether results are
            restricted to it at all. Off (the default) always shows every
            venue city-wide, ranked by distance from that origin. */}
        <FilterChip
          label={`${precinct} only`}
          selected={precinctOnly}
          href={feedHref(activeFilters, openNowOnly, !precinctOnly)}
        />
        {visibleFilterDefs.map((def) =>
          def.id === "open_now" ? (
            // F1.8: the one chip that toggles OFF, not off-then-on — every
            // other chip's href adds/removes itself from the AND-composed
            // `filters` list; this one flips openNowOnly instead, since
            // it's enforced by the base query, not an attribute filter.
            <FilterChip
              key={def.id}
              label={def.label}
              selected={openNowOnly}
              href={feedHref(activeFilters, !openNowOnly, precinctOnly)}
            />
          ) : (
            <FilterChip
              key={def.id}
              label={def.label}
              selected={activeFilters.includes(def.id)}
              href={filterHref(activeFilters, def.id, openNowOnly, precinctOnly)}
            />
          ),
        )}
      </div>

      {relaxation.disclosure ? (
        <p className="rounded-lg bg-ink-700 px-4 py-2 text-sm text-ink-100">{relaxation.disclosure}</p>
      ) : null}

      {relaxation.venues.length > 0 ? (
        renderVenueList(relaxation, mapEnabled, openNowOnly, { lat, lng })
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {relaxation.closingSoon.map((venue, index) => (
              <Link key={venue.id} href={`/venue/${venue.id}?position=${index}&source=closing_soon`}>
                <VenueCard {...venueCardProps(venue, true, { lat, lng }, relaxation.venueLocations)} />
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
