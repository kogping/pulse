import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { venueStore } from "@/lib/venue-store";
import { VenueForm } from "../../venue-form";

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/signin");

  const { id } = await params;
  const venue = await venueStore.getWithDetails(id);
  if (!venue) notFound();

  return (
    <main>
      <h1>Edit {venue.name}</h1>
      {venue.source === "google_places" ? (
        <p role="status">
          This is an unclaimed Google listing — nothing here has been verified by a curator yet. Saving this form
          claims it: it becomes a fully curated venue, attributed to you.
        </p>
      ) : null}
      <VenueForm mode="edit" venueId={venue.id} initialValue={venue} />
    </main>
  );
}
