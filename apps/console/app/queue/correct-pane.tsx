"use client";

import { useState } from "react";
import type { QueueItem } from "@pulse/db";

interface CorrectPaneProps {
  item: QueueItem;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

// Chips, not a native <select> — selectOption() dispatches no pointer
// events at all, which would make the queue's tap counter (see
// e2e/helpers/tap-counter.ts) record 0 taps for select/boolean items and
// let the "<=3 taps" claim pass without proving anything. Chips give an
// honest count and a better 360px thumb target.
export function CorrectPane({ item, onSubmit, onCancel }: CorrectPaneProps) {
  const [value, setValue] = useState(item.current.value);

  const chipOptions = item.inputType === "boolean" ? ["yes", "no"] : item.inputType === "select" ? (item.options ?? []) : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {chipOptions ? (
        <div role="radiogroup" aria-label={item.label} className="flex flex-wrap gap-2">
          {chipOptions.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={value === option}
              data-value={option}
              onClick={() => setValue(option)}
              className={`min-h-touch rounded-full border px-4 text-sm font-medium ${
                value === option ? "border-accent bg-accent-subtle text-accent" : "border-ink-700 text-ink-100"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-ink-300">
          {item.label}
          {/* autoFocus so opening the pane doesn't cost a tap to focus the field. */}
          <input
            autoFocus
            type={item.inputType === "time" ? "time" : "text"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-touch rounded-lg border border-ink-700 bg-ink-900 px-3 text-base text-ink-50"
          />
        </label>
      )}

      <div className="mt-auto flex gap-3 pb-6">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch min-w-touch flex-1 rounded-lg border border-ink-700 px-4 text-base font-medium text-ink-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(value)}
          disabled={value.trim().length === 0}
          className="min-h-touch min-w-touch flex-1 rounded-lg bg-accent px-4 text-base font-semibold text-white disabled:opacity-40"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
