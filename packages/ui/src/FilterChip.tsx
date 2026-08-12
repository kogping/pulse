export interface FilterChipProps {
  label: string;
  selected: boolean;
  onClick?: () => void;
  /** Renders an <a href> instead of a <button> — for filters whose active
   *  set lives in the URL (F1.6), so the chip is a real navigation, back/
   *  forward works natively, and it's never a <button> nested inside a
   *  wrapping <a> (invalid, nested interactive content). */
  href?: string;
}

const CHIP_CLASS_NAME =
  "inline-flex min-h-touch items-center px-4 text-sm font-medium";

// Selected uses a dark label on the light accent-subtle fill rather than a
// light label on solid accent — accent-on-ink and ink-50-on-accent both
// fall short of 7:1 (see tokens.test.ts), but ink-950-on-accent-subtle
// clears it comfortably.
export function FilterChip({ label, selected, onClick, href }: FilterChipProps) {
  const className = `${CHIP_CLASS_NAME} ${selected ? "bg-accent-subtle text-ink-950" : "bg-ink-700 text-ink-100"}`;

  if (href !== undefined) {
    return (
      <a href={href} aria-pressed={selected} className={className}>
        {label}
      </a>
    );
  }

  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={className}>
      {label}
    </button>
  );
}
