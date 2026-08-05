import { getPrimaryHubForVenue } from "@pulse/db";
import { TransportCountdown } from "./transport-countdown";

export { TFNSW_ATTRIBUTION } from "./tfnsw-attribution";

export interface TransportSlotProps {
  venueId: string;
}

// F3: resolves the venue's primary linked hub server-side (onboarding-time
// data from packages/db/src/hub-links.ts) and hands off to the client
// component that owns the actual live/scheduled fetch + ticking countdown.
// A venue with no linked hub (never onboarded near one, or none in range)
// renders nothing — there is no "transport coming soon" placeholder to
// fall back to once this slot is live.
export async function TransportSlot({ venueId }: TransportSlotProps) {
  const hub = await getPrimaryHubForVenue(venueId);
  if (!hub) return null;

  return <TransportCountdown hubId={hub.hubId} hubName={hub.hubName} walkSeconds={hub.walkSeconds} />;
}
