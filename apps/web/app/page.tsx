import { EmptyState, FilterChip, VenueCard } from "@pulse/ui";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col gap-4 px-4 pb-safe-b pt-safe-t">
      <h1 className="pt-4 text-2xl font-semibold text-ink-50">Pulse — what's good tonight</h1>
      <div className="flex gap-2 overflow-x-auto">
        <FilterChip label="Open now" selected />
        <FilterChip label="Live music" selected={false} />
        <FilterChip label="No cover" selected={false} />
      </div>
      <VenueCard
        name="The Lansdowne"
        precinct="Chippendale"
        attributes={[
          { label: "Cover", attribute: { confidence: "fresh", value: "$15", lastVerifiedAt: new Date() } },
          { label: "Dress code", attribute: { confidence: "unconfirmed" } },
        ]}
        lastEntry={{ mode: "scheduled", label: "Last entry 1:00 AM" }}
      />
      <EmptyState heading="That's everything nearby" body="Try widening your search or checking back later." />
    </main>
  );
}
