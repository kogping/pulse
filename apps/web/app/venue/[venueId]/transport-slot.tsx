// Recommended wording from the P0.5 TfNSW spike (docs/spikes/tfnsw.md §3),
// pending confirmation from opendataprogram@transport.nsw.gov.au before
// launch. Exported so P2.11's live/scheduled transit module renders the
// same string once it lands here instead of restating it.
export const TFNSW_ATTRIBUTION =
  "Contains data based on Transport for NSW Open Data, licensed under a Creative Commons Attribution 4.0 licence (CC BY 4.0).";

// Placeholder for the transport module (P2.11 fills this slot with live/
// scheduled departures per CLAUDE.md invariant #5). Kept as its own
// component so P2.11 is a body swap here, not a new slot in page.tsx.
export function TransportSlot() {
  return (
    <section data-testid="transport-slot" className="flex flex-col gap-1 rounded-lg bg-ink-900 p-4">
      <p className="text-sm text-ink-300">Transport info coming soon</p>
      <p className="text-xs text-ink-400">{TFNSW_ATTRIBUTION}</p>
    </section>
  );
}
