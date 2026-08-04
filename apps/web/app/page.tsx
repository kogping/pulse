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
import { loadFeed } from "./feed/load-feed";

// Fixed seed precinct/coords — browser geolocation is out of scope for
// F1.6/F1.7 (CLAUDE.md invariant 6: coordinates are used in-request and
// discarded, never persisted, so wiring a real location prompt is its own
// task, not a side effect of this one). Newtown matches the seeded data
// (packages/db/scripts/seed.ts) and the existing e2e fixture
// (apps/web/e2e/feed-2am.spec.ts).
const DEFAULT_PRECINCT = "Newtown";
const DEFAULT_LAT = -33.8975;
const DEFAULT_LNG = 151.1795;

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
  const rawFilters = typeof params.filters === "string" ? params.filters.split(",").filter(Boolean) : [];
  const requestedFilters = parseIntentFilterIds(rawFilters);

  // The accessible chip is omitted from the page entirely when the flag is
  // off, not merely disabled — docs/runbook/kill-switches.md: "when off,
  // the filter control is hidden". Stripped from the active set too, so a
  // stale shared URL from before the flag was flipped off can't silently
  // re-enable it.
  const accessibilityEnabled = await getFlag("accessibility_filter_enabled");
  const activeFilters = accessibilityEnabled ? requestedFilters : requestedFilters.filter((id) => id !== "accessible");
  const visibleFilterDefs = INTENT_FILTER_REGISTRY.filter((def) => def.id !== "accessible" || accessibilityEnabled);

  const relaxation = await loadFeed({
    precinct: DEFAULT_PRECINCT,
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
    filters: [...activeFilters, "open_now"],
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t">
      <h1 className="pt-4 text-2xl font-semibold text-ink-50">Pulse — what's good tonight</h1>
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
        <div className="flex flex-col gap-4">
          {relaxation.venues.map((venue) => (
            <VenueCard key={venue.id} {...venueCardProps(venue)} />
          ))}
        </div>
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
            {relaxation.closingSoon.map((venue) => (
              <VenueCard key={venue.id} {...venueCardProps(venue)} />
            ))}
          </div>
        </section>
      ) : null}

      <FeedAnalytics
        precinct={DEFAULT_PRECINCT}
        filters={activeFilters}
        resultCount={relaxation.venues.length}
        attempts={relaxation.attempts}
      />
    </main>
  );
}
