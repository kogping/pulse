// Installed via page.addInitScript so it's present before the queue's own
// scripts run. Counts real taps, not synthetic interaction: Playwright's
// tap()/click() dispatch trusted CDP input events (a real pointerdown),
// while its auto-scroll (DOM.scrollIntoViewIfNeeded) and native
// <select>/fill() interactions emit no pointer events at all — which is
// why the queue's correct-pane uses chips instead of a native <select>
// (see app/queue/correct-pane.tsx): a native select would silently record
// 0 taps and let the "<=3 taps" assertion pass without proving anything.
export function installTapCounter(): void {
  const counts: Record<string, number> = {};
  const events: Array<{ item: string; tag: string; label: string; at: number }> = [];

  const INTERACTIVE =
    'button, [role="button"], [role="radio"], [role="option"], [role="switch"], a[href], input, select, textarea, label, summary';

  addEventListener(
    "pointerdown",
    (event) => {
      const e = event as PointerEvent;
      if (!e.isTrusted || !e.isPrimary) return;
      const target = e.target as Element | null;
      if (!target?.closest) return;

      // The undo toast overlays the NEXT item; its taps must not be
      // attributed to whichever item happens to be current.
      if (target.closest("[data-tap-exempt]")) return;

      const el = target.closest(INTERACTIVE);
      if (!el) return; // scroll/drag started on non-interactive chrome

      const owning = el.closest("[data-queue-item]");
      const item = owning?.getAttribute("data-queue-item") ?? "__none__";

      counts[item] = (counts[item] ?? 0) + 1;
      events.push({
        item,
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("data-testid") ?? el.textContent ?? "").slice(0, 40),
        at: Math.round(performance.now()),
      });
    },
    true, // capture: counts even if the app calls stopPropagation()
  );

  Object.defineProperty(window, "__tapCounts", { get: () => counts, configurable: true });
  Object.defineProperty(window, "__tapEvents", { get: () => events, configurable: true });
}
