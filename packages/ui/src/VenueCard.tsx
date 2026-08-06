import { Badge, type BadgeAttribute } from "./Badge";
import { Countdown, type CountdownData } from "./Countdown";

export interface VenueCardProps {
  name: string;
  precinct: string;
  /** "google_places" venues carry no attributes and no curator pitch — this
   *  renders an explicit "not yet verified" line instead of an empty badge
   *  row reading as silently blank. Never inferred from an empty attributes
   *  array: a curated venue with all-unconfirmed badges must not show this. */
  source?: "curator" | "google_places";
  attributes: { label: string; attribute: BadgeAttribute }[];
  lastEntry?: CountdownData;
  /** Resolved by the caller (packages/ui has no @pulse/db dependency) from
   *  VenuePhoto: `src` is either the curator's URL or this app's
   *  /api/venue-photo proxy. `attribution` renders as an overlay caption —
   *  required by the Places API ToS whenever the photo came from Google. */
  photo?: { src: string; attribution: string | null };
}

export function VenueCard({ name, precinct, source, attributes, lastEntry, photo }: VenueCardProps) {
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-ink-900 p-4">
      {photo ? (
        <div className="relative -mx-4 -mt-4 overflow-hidden rounded-t-xl">
          <img src={photo.src} alt={name} className="h-40 w-full object-cover" loading="lazy" />
          {photo.attribution ? (
            <p className="absolute bottom-1 right-2 text-[10px] text-ink-50/80">Photo: {photo.attribution}</p>
          ) : null}
        </div>
      ) : null}
      <div>
        <h3 className="text-lg font-semibold text-ink-50">{name}</h3>
        <p className="text-sm text-ink-300">{precinct}</p>
      </div>
      {source === "google_places" ? (
        <p className="text-xs text-ink-400">Listing from Google — nothing verified by a curator yet</p>
      ) : null}
      {attributes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attributes.map(({ label, attribute }) => (
            <Badge key={label} label={label} attribute={attribute} />
          ))}
        </div>
      ) : null}
      {lastEntry ? <Countdown data={lastEntry} /> : null}
    </article>
  );
}
