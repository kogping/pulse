"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@pulse/analytics";
import type { Confidence, QueueItem } from "@pulse/db";
import { attachOutboxListeners, enqueueConfirm, enqueueCorrect, undo as undoOutboxAction } from "@/lib/outbox";
import { CorrectPane } from "./correct-pane";
import { PendingBadge } from "./pending-badge";

const TOAST_DURATION_MS = 5_000;

interface ToastState {
  actionId: string;
  message: string;
}

function confidenceLabel(confidence: Confidence): string {
  if (confidence === "fresh") return "Fresh";
  if (confidence === "ageing") return "Ageing";
  return "Unconfirmed";
}

function confidenceClass(confidence: Confidence): string {
  if (confidence === "fresh") return "text-fresh";
  if (confidence === "ageing") return "text-ageing";
  return "text-unconfirmed";
}

export function QueueRunner({ initialItems }: { initialItems: QueueItem[] }) {
  const [index, setIndex] = useState(0);
  const [correcting, setCorrecting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const itemStartRef = useRef<number>(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => attachOutboxListeners(), []);

  useEffect(() => {
    itemStartRef.current = performance.now();
    setCorrecting(false);
  }, [index]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const item = initialItems[index];

  function showToast(actionId: string, message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ actionId, message });
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  async function handleConfirm() {
    if (!item) return;
    const durationMs = Math.round(performance.now() - itemStartRef.current);
    const actionId = await enqueueConfirm({
      venueAttributeId: item.id,
      previousValue: item.current.value,
      previousVerifiedAt: item.current.lastVerifiedAt.toISOString(),
      durationMs,
    });
    track("verification_event", { action: "confirm", attributeKey: item.attributeKey, durationMs });
    showToast(actionId, `${item.label} confirmed`);
    setIndex((i) => i + 1);
  }

  async function handleCorrectSubmit(value: string) {
    if (!item) return;
    const durationMs = Math.round(performance.now() - itemStartRef.current);
    const actionId = await enqueueCorrect({
      venueAttributeId: item.id,
      value,
      previousValue: item.current.value,
      previousVerifiedAt: item.current.lastVerifiedAt.toISOString(),
      durationMs,
    });
    track("verification_event", { action: "correct", attributeKey: item.attributeKey, durationMs });
    showToast(actionId, `${item.label} updated`);
    setIndex((i) => i + 1);
  }

  async function handleUndo() {
    if (!toast) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const actionId = toast.actionId;
    setToast(null);
    await undoOutboxAction(actionId);
  }

  return (
    <main className="flex min-h-dvh flex-col bg-ink-950 pb-safe-b pt-safe-t text-ink-50">
      <header className="flex items-center justify-between px-4 py-4">
        <h1 className="text-lg font-semibold">Queue</h1>
        <div className="flex items-center gap-3 text-sm text-ink-300">
          {item ? <span>{index + 1} / {initialItems.length}</span> : null}
          <PendingBadge />
        </div>
      </header>

      {item ? (
        <div key={item.id} data-queue-item={item.id} className="flex flex-1 flex-col gap-4 px-4 pb-6">
          <div>
            <p className="text-sm text-ink-300">{item.venueName}</p>
            <p data-testid="queue-item-prompt" className="text-lg font-semibold">
              {item.label}: {item.current.value}
            </p>
            <p className={`text-sm ${confidenceClass(item.current.confidence)}`}>
              {confidenceLabel(item.current.confidence)}
              {item.flagged ? " · flagged by a visitor" : ""}
            </p>
          </div>

          {correcting ? (
            <CorrectPane item={item} onSubmit={handleCorrectSubmit} onCancel={() => setCorrecting(false)} />
          ) : (
            <div className="mt-auto flex gap-3">
              <button
                type="button"
                onClick={handleConfirm}
                className="min-h-touch min-w-touch flex-1 rounded-lg bg-fresh px-4 text-base font-semibold text-white"
              >
                Still right
              </button>
              <button
                type="button"
                onClick={() => setCorrecting(true)}
                className="min-h-touch min-w-touch flex-1 rounded-lg border border-ink-700 px-4 text-base font-semibold text-ink-50"
              >
                Correct
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-base font-medium">Queue cleared</p>
          <p className="text-sm text-ink-300">Nice work — nothing left to verify right now.</p>
        </div>
      )}

      {toast ? (
        // pointer-events-none on the container + pointer-events-auto only on
        // Undo: this toast is fixed above the action row and must never
        // intercept a tap meant for the next item's buttons, or Playwright's
        // actionability check silently waits out the full 5s auto-dismiss.
        <div
          data-tap-exempt
          role="status"
          className="pointer-events-none fixed inset-x-4 bottom-24 z-10 flex items-center justify-between rounded-lg bg-ink-700 px-4 py-3 text-sm shadow-lg"
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="pointer-events-auto min-h-touch rounded px-3 font-semibold text-accent"
          >
            Undo
          </button>
        </div>
      ) : null}
    </main>
  );
}
