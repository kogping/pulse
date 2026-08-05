import { ATTRIBUTE_REGISTRY_BY_KEY, type AttributeView } from "@pulse/db";

export interface VenueAttributeCardProps {
  attributes: AttributeView[];
}

function formatRelative(date: Date, nowMs: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function labelFor(key: string): string {
  return ATTRIBUTE_REGISTRY_BY_KEY.get(key)?.label ?? key;
}

// F2.4's badge rendering, exhaustive over AttributeView: fresh and ageing
// both show the value with a provenance line (ageing's de-emphasised);
// unconfirmed shows neither the value nor any provenance line — "Not
// confirmed" and nothing else. There is no branch here that reads `.value`
// off an unconfirmed attribute (CLAUDE.md invariant #3).
export function VenueAttributeCard({ attributes }: VenueAttributeCardProps) {
  if (attributes.length === 0) return null;

  return (
    <dl className="flex flex-col gap-3" data-testid="venue-attribute-card">
      {attributes.map((attribute) => {
        const label = labelFor(attribute.key);

        if (attribute.confidence === "unconfirmed") {
          return (
            <div key={attribute.key} className="flex flex-col" data-testid={`attribute-${attribute.key}`}>
              <dt className="text-sm text-ink-300">{label}</dt>
              <dd className="text-sm text-ink-100">Not confirmed</dd>
            </div>
          );
        }

        const provenance =
          attribute.confidence === "fresh"
            ? `Verified ${formatRelative(attribute.lastVerifiedAt)} by ${attribute.verifiedBy.name}`
            : `Last checked ${formatRelative(attribute.lastVerifiedAt)} — may have changed`;

        return (
          <div key={attribute.key} className="flex flex-col" data-testid={`attribute-${attribute.key}`}>
            <dt className="text-sm text-ink-300">{label}</dt>
            <dd className={attribute.confidence === "ageing" ? "text-sm text-ink-300" : "text-base text-ink-50"}>
              {attribute.value}
            </dd>
            <p className="text-xs text-ink-400">{provenance}</p>
          </div>
        );
      })}
    </dl>
  );
}
