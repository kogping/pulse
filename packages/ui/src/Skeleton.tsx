export interface SkeletonProps {
  /** Accessible label announced while the real content loads. */
  label?: string;
  className?: string;
}

// Placeholder only — never renders venue data. There is no version of this
// component that accepts stale content as a fallback (see CLAUDE.md
// invariant #2: freshness is computed, never cached as a stand-in).
export function Skeleton({ label = "Loading", className = "h-20 w-full" }: SkeletonProps) {
  return (
    <div role="status" aria-label={label} className={`animate-pulse bg-ink-700 ${className}`}>
      <span className="sr-only">{label}</span>
    </div>
  );
}
