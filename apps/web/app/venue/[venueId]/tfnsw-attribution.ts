// Recommended wording from the P0.5 TfNSW spike (docs/spikes/tfnsw.md §3),
// pending confirmation from opendataprogram@transport.nsw.gov.au before
// launch. Its own module (not colocated with transport-slot.tsx or
// transport-countdown.tsx) so the server component and the client
// component that both need it don't import each other.
export const TFNSW_ATTRIBUTION =
  "Contains data based on Transport for NSW Open Data, licensed under a Creative Commons Attribution 4.0 licence (CC BY 4.0).";
