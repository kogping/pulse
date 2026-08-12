// Structurally identical to packages/db's ResolvedVenueAttribute
// (freshness.ts) by design, so a value resolved server-side can be passed
// straight through without a mapping layer. Kept as a local type — not an
// import — so @pulse/ui has no dependency on @pulse/db.
export type BadgeAttribute =
  | { confidence: "fresh" | "ageing"; value: string; lastVerifiedAt: Date }
  | { confidence: "unconfirmed" };

export interface BadgeProps {
  label: string;
  attribute: BadgeAttribute;
}

const DOT_CLASS: Record<BadgeAttribute["confidence"], string> = {
  fresh: "bg-fresh",
  ageing: "bg-ageing",
  unconfirmed: "bg-unconfirmed",
};

function formatLastVerified(date: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Every attribute badge in the app renders through this component and only
// this component — the discriminated BadgeAttribute union makes it a type
// error to read `.value` off an unconfirmed attribute, so there is no way
// to render a bare, unprovenanced value (see CLAUDE.md invariant #3).
export function Badge({ label, attribute }: BadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-ink-900 px-2.5 py-1 text-sm">
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT_CLASS[attribute.confidence]}`} />
      {attribute.confidence === "unconfirmed" ? (
        <span className="text-ink-100">{label}: unconfirmed</span>
      ) : (
        <>
          <span className="text-ink-50">
            {label}: {attribute.value}
          </span>
          <span className="text-ink-300">· {formatLastVerified(attribute.lastVerifiedAt)}</span>
        </>
      )}
    </span>
  );
}
