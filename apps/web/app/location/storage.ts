// The "remembered precinct" for F1.1's denied/unavailable/picker branch:
// once a visitor has picked (or been resolved to) a precinct, we don't
// re-run geolocation or re-show the picker on their next visit — "no
// nagging re-prompt". Precinct identity only; never coordinates, never a
// user identifier.
const STORAGE_KEY = "pulse:precinct";

export interface RememberedPrecinct {
  id: string;
  name: string;
}

export function readRememberedPrecinct(): RememberedPrecinct | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<RememberedPrecinct>;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return undefined;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return undefined;
  }
}

export function rememberPrecinct(precinct: RememberedPrecinct): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(precinct));
  } catch {
    // Private mode / quota exceeded — worst case we ask again next visit.
  }
}

export function forgetRememberedPrecinct(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op — nothing to clean up if storage is unavailable.
  }
}
