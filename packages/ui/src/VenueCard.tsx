import { Badge, type BadgeAttribute } from "./Badge";
import { Countdown, type CountdownData } from "./Countdown";

export interface VenueCardProps {
  name: string;
  precinct: string;
  attributes: { label: string; attribute: BadgeAttribute }[];
  lastEntry?: CountdownData;
}

export function VenueCard({ name, precinct, attributes, lastEntry }: VenueCardProps) {
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-ink-900 p-4">
      <div>
        <h3 className="text-lg font-semibold text-ink-50">{name}</h3>
        <p className="text-sm text-ink-300">{precinct}</p>
      </div>
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
