export interface PrecinctOption {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export async function fetchPrecincts(): Promise<PrecinctOption[]> {
  const response = await fetch("/api/precincts");
  if (!response.ok) return [];
  const body = (await response.json()) as { precincts: PrecinctOption[] };
  return body.precincts;
}

export type ResolveLocationResult = { status: "resolved"; precinct: PrecinctOption } | { status: "error" };

// Sends the visitor's raw coordinates to the server for the one thing they're
// used for — finding the nearest precinct — and gets back a precinct, never
// the coordinates themselves.
export async function resolveLocation(lat: number, lng: number): Promise<ResolveLocationResult> {
  try {
    const response = await fetch(`/api/location/resolve?lat=${lat}&lng=${lng}`);
    if (!response.ok) return { status: "error" };
    return (await response.json()) as ResolveLocationResult;
  } catch {
    return { status: "error" };
  }
}
