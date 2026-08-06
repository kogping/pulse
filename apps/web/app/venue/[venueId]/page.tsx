import { notFound } from "next/navigation";
import { getVenueDetail } from "@pulse/db";
import { DirectionsLink } from "./directions-link";
import { TransportSlot } from "./transport-slot";
import { VenueAnalytics } from "./venue-analytics";
import { VenueAttributeCard } from "./venue-card";

interface VenuePageProps {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VenuePage({ params, searchParams }: VenuePageProps) {
  const { venueId } = await params;
  const query = await searchParams;
  const venue = await getVenueDetail(venueId);
  if (!venue) notFound();

  const position = typeof query.position === "string" ? Number(query.position) : 0;
  const analyticsSource = typeof query.source === "string" ? query.source : "unknown";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t">
      <div className="pt-4">
        <h1 className="text-2xl font-semibold text-ink-50">{venue.name}</h1>
        <p className="text-sm text-ink-300">{venue.precinct}</p>
      </div>

      {venue.source === "google_places" ? (
        <p className="text-xs text-ink-400">Listing from Google — nothing verified by a curator yet</p>
      ) : null}

      {venue.curatorPitch ? <p className="text-base text-ink-100">{venue.curatorPitch}</p> : null}

      <p className="text-sm text-ink-300" data-testid="venue-hours">
        {venue.tonight.isOpenTonight ? `Open tonight until ${venue.tonight.closesAt}` : "Closed tonight"}
      </p>

      <VenueAttributeCard venueId={venue.id} attributes={venue.attributes} />

      <DirectionsLink name={venue.name} lat={venue.lat} lng={venue.lng} />

      <TransportSlot venueId={venue.id} />

      <VenueAnalytics venueId={venue.id} position={position} source={analyticsSource} />
    </main>
  );
}
