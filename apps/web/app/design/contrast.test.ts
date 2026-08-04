import { describe, expect, it } from "vitest";
import { contrastRatio, MIN_CONTRAST_RATIO, REGISTERED_TEXT_BACKGROUND_PAIRS } from "@pulse/ui";

// Gate for the "every text/background token pair used in the app must
// compute >= 7:1" invariant. This lives in apps/web (not just colocated in
// packages/ui) because this app is the surface that actually renders the
// tokens to a night-time, outdoors, one-handed screen — a regression here
// is a regression a real user hits.
describe("web design token contrast", () => {
  it.each(REGISTERED_TEXT_BACKGROUND_PAIRS)(
    "$name ($usedBy) computes >= 7:1",
    ({ fg, bg }) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    },
  );
});
