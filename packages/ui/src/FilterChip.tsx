export interface FilterChipProps {
  label: string;
  selected: boolean;
  onClick?: () => void;
}

// Selected uses a dark label on the light accent-subtle fill rather than a
// light label on solid accent — accent-on-ink and ink-50-on-accent both
// fall short of 7:1 (see tokens.test.ts), but ink-950-on-accent-subtle
// clears it comfortably.
export function FilterChip({ label, selected, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex min-h-touch items-center rounded-full px-4 text-sm font-medium ${
        selected ? "bg-accent-subtle text-ink-950" : "bg-ink-700 text-ink-100"
      }`}
    >
      {label}
    </button>
  );
}
