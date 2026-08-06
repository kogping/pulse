"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchEnabledPrecincts, resolveLocation, type PrecinctOption } from "./api";
import { PrecinctPicker } from "./precinct-picker";
import { OutOfCoverageScreen } from "./out-of-coverage-screen";
import { readRememberedPrecinct, rememberPrecinct, forgetRememberedPrecinct } from "./storage";
import { geohashDecode, geohashEncode } from "../api/feed/geohash";

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

// >3s of waiting on geolocation reads as broken, not as "still working" —
// F1.1's slow-geolocation branch renders the picker instead of a spinner.
const GEOLOCATION_SOFT_TIMEOUT_MS = 3_000;

type GateState = "resolving" | "picker" | "out_of_coverage";

export interface LocationGateProps {
  // Preserves a `?filters=` the visitor arrived with (e.g. a shared link)
  // across the redirect to a precinct-qualified URL.
  filtersParam?: string;
}

function targetHref(precinct: PrecinctOption, lat: number, lng: number, filtersParam?: string): string {
  const params = new URLSearchParams({ precinct: precinct.name, lat: String(lat), lng: String(lng) });
  if (filtersParam) params.set("filters", filtersParam);
  return `/?${params.toString()}`;
}

// F1.1's four non-happy-path branches for resolving "where is this visitor":
// granted+fast → nearest enabled precinct; denied/unavailable/slow → precinct
// picker; resolved-but-nowhere-enabled-nearby → out-of-coverage screen. The
// happy path (granted, resolves inside coverage) never renders anything
// here — it replaces the URL with a precinct-qualified one and Home
// re-renders server-side from there.
export function LocationGate({ filtersParam }: LocationGateProps) {
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
      fetchEnabledPrecincts().then((options) => {
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
        // The visitor's raw coordinates went to /api/location/resolve only
        // to find the nearest area label (result.precinct.name) — the
        // redirect itself carries the visitor's *own* position, truncated
        // to a geohash-6 cell, so the feed actually ranks by proximity to
        // where they are rather than to the area's hub centroid.
        rememberPrecinct({ id: result.precinct.id, name: result.precinct.name });
        const cell = toGeohash6Cell(latitude, longitude);
        router.replace(targetHref(result.precinct, cell.lat, cell.lng, filtersParam));
        return;
      }
      if (result.status === "out_of_coverage") {
        setState("out_of_coverage");
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
      fetchEnabledPrecincts().then((options) => {
        if (cancelled) return;
        const stillEnabled = options.find((option) => option.id === remembered.id);
        if (stillEnabled) {
          router.replace(targetHref(stillEnabled, stillEnabled.lat, stillEnabled.lng, filtersParam));
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
    router.replace(targetHref(precinct, precinct.lat, precinct.lng, filtersParam));
  }

  if (state === "out_of_coverage") return <OutOfCoverageScreen />;
  if (state === "picker") return <PrecinctPicker precincts={precincts} loading={precinctsLoading} onSelect={handleSelect} />;

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="location-resolving">
      <p className="text-sm text-ink-300">Finding what's good near you…</p>
    </div>
  );
}
