export interface EmptyStateProps {
  heading: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ heading, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 bg-ink-700 px-6 py-10 text-center">
      <p className="text-lg font-semibold text-ink-50">{heading}</p>
      {body ? <p className="text-sm text-ink-100">{body}</p> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 min-h-touch min-w-touch bg-accent-subtle px-4 text-sm font-medium text-ink-950"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
