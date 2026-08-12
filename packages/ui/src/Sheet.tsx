export interface SheetProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

// Bottom sheet, not a centered modal — this is a one-handed, on-a-phone
// app, so actions live within thumb reach at the bottom of the screen.
// Padded for the safe-area inset so it clears the home indicator on
// notched phones.
export function Sheet({ title, open, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="presentation">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[85vh] w-full flex-col gap-4 bg-ink-900 px-4 pb-safe-b pt-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-touch min-w-touch text-ink-300"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
