"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchPrecincts, resolveLocation, type PrecinctOption } from "./api";
import { PrecinctPicker } from "./precinct-picker";
import { readRememberedPrecinct, rememberPrecinct, forgetRememberedPrecinct } from "./storage";
import { geohashDecode, geohashEncode, haversineDistanceMeters } from "../api/feed/geohash";

// City-wide ranking (feed.ts's FEED_SCORING_WEIGHTS.distance) needs the
// visitor's real position, not a precinct hub centroid, or "closest first"
// is meaningless. Truncating to a geohash-6 cell (~600m) before it ever
// reaches the URL keeps this within the spirit of CLAUDE.md invariant 6
// ("persist precinct + geohash-5 at most") — one geohash character finer
// than that ceiling, deliberately: a 5km geohash-5 cell is coarser than
// most Sydney suburbs and would make proximity ranking pointless. Nothing
// here is persisted server-side; it's a query param, used in-request, same
// as any other feed coordinate.
function toGeohash6Cell(lat: number, lng: number): { lat: number; lng: number } {
  return geohashDecode(geohashEncode(lat, lng, 6));
}

// A visitor's real position only makes a better ranking origin than the
// resolved precinct's own hub when they're actually somewhere in Sydney —
// otherwise (testing from another city, a laptop with a coarse/wrong IP
// geolocation fix, etc.) their real coordinates are outside every venue's
// relaxation-ladder radius (feed/relaxation.ts's RADIUS_LADDER_METERS tops
// out at 6km) and the feed comes back empty no matter which suburb they
// picked. 25km comfortably covers PRECINCT_REGISTRY's full spread
// (Parramatta to Bondi Beach, Manly to Cronulla) with room to spare, so
// anyone genuinely in metro Sydney is always well inside it.
const COVERAGE_MAX_DISTANCE_METERS = 25_000;

// >3s of waiting on geolocation reads as broken, not as "still working" —
// F1.1's slow-geolocation branch renders the picker instead of a spinner.
const GEOLOCATION_SOFT_TIMEOUT_MS = 3_000;

type GateState = "resolving" | "picker";

export interface LocationGateProps {
  // Preserves a `?filters=` the visitor arrived with (e.g. a shared link)
  // across the redirect to a precinct-qualified URL.
  filtersParam?: string;
  // Same preservation for the opt-in "this suburb only" restriction — see
  // page.tsx's precinctOnly. Carried separately from precinct/lat/lng since
  // it's a distinct concept: whether to restrict results, not where to rank
  // from.
  precinctOnlyParam?: string;
}

function targetHref(precinct: PrecinctOption, lat: number, lng: number, filtersParam?: string, precinctOnlyParam?: string): string {
  const params = new URLSearchParams({ precinct: precinct.name, lat: String(lat), lng: String(lng) });
  if (filtersParam) params.set("filters", filtersParam);
  if (precinctOnlyParam) params.set("precinctOnly", precinctOnlyParam);
  return `/?${params.toString()}`;
}

// F1.1's non-happy-path branch for resolving "where is this visitor":
// granted+fast → nearest precinct; denied/unavailable/slow → precinct
// picker. Coverage is city-wide, so a granted geolocation always resolves —
// the happy path never renders anything here — it replaces the URL with a
// precinct-qualified one and Home re-renders server-side from there.
export function LocationGate({ filtersParam, precinctOnlyParam }: LocationGateProps) {
  const router = useRouter();
  const [state, setState] = useState<GateState>("resolving");
  const [precincts, setPrecincts] = useState<PrecinctOption[]>([]);
  const [precinctsLoading, setPrecinctsLoading] = useState(true);
  const bailedToPicker = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function goToPicker() {
      if (cancelled || bailedToPicker.current) return;
      bailedToPicker.current = true;
      setState("picker");
      fetchPrecincts().then((options) => {
        if (cancelled) return;
        setPrecincts(options);
        setPrecinctsLoading(false);
      });
    }

    async function handlePosition(position: GeolocationPosition) {
      if (cancelled || bailedToPicker.current) return;
      const { latitude, longitude } = position.coords;
      const result = await resolveLocation(latitude, longitude);
      if (cancelled || bailedToPicker.current) return;

      if (result.status === "resolved") {
        rememberPrecinct({ id: result.precinct.id, name: result.precinct.name });
        // The visitor's raw coordinates went to /api/location/resolve only
        // to find the nearest area label (result.precinct.name). When
        // they're actually near it, the redirect carries their *own*
        // position (truncated to a geohash-6 cell) so the feed ranks by
        // proximity to where they really are rather than to the area's hub
        // centroid. But "nearest enabled precinct" still returns *a*
        // precinct even when the visitor is nowhere near Sydney at all —
        // falling back to the hub centroid there is what keeps the feed
        // non-empty instead of ranking from a real position outside every
        // venue's search radius (see COVERAGE_MAX_DISTANCE_METERS above).
        const distanceToHub = haversineDistanceMeters({ lat: latitude, lng: longitude }, result.precinct);
        const origin =
          distanceToHub <= COVERAGE_MAX_DISTANCE_METERS ? toGeohash6Cell(latitude, longitude) : result.precinct;
        router.replace(targetHref(result.precinct, origin.lat, origin.lng, filtersParam, precinctOnlyParam));
        return;
      }
      // Transient resolve failure — fall back to letting the visitor pick.
      goToPicker();
    }

    async function startGeolocation() {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        goToPicker();
        return;
      }

      const softTimeout = setTimeout(goToPicker, GEOLOCATION_SOFT_TIMEOUT_MS);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(softTimeout);
          void handlePosition(position);
        },
        () => {
          clearTimeout(softTimeout);
          goToPicker();
        },
        { timeout: GEOLOCATION_SOFT_TIMEOUT_MS },
      );
    }

    // A previously remembered precinct (from an earlier picker choice or a
    // prior successful resolve) skips geolocation entirely — the browser's
    // own permission prompt is never re-triggered on repeat visits.
    const remembered = readRememberedPrecinct();
    if (remembered) {
      fetchPrecincts().then((options) => {
        if (cancelled) return;
        const stillEnabled = options.find((option) => option.id === remembered.id);
        if (stillEnabled) {
          router.replace(targetHref(stillEnabled, stillEnabled.lat, stillEnabled.lng, filtersParam, precinctOnlyParam));
          return;
        }
        forgetRememberedPrecinct();
        void startGeolocation();
      });
      return () => {
        cancelled = true;
      };
    }

    void startGeolocation();

    return () => {
      cancelled = true;
    };
    // Runs once on mount — router/filtersParam are stable for the gate's lifetime.
  }, []);

  function handleSelect(precinct: PrecinctOption) {
    rememberPrecinct({ id: precinct.id, name: precinct.name });
    // Picking a precinct here only seeds the ranking origin (lat/lng) — it
    // never turns on the "this suburb only" restriction on its own; that's
    // an explicit, separate opt-in via the feed's filter chip.
    router.replace(targetHref(precinct, precinct.lat, precinct.lng, filtersParam, precinctOnlyParam));
  }

  if (state === "picker") return <PrecinctPicker precincts={precincts} loading={precinctsLoading} onSelect={handleSelect} />;

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="location-resolving">
      <p className="text-sm text-ink-300">Finding what's good near you…</p>
    </div>
  );
}
