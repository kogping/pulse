import { describe, expect, it } from "vitest";
import { contrastRatio, MIN_CONTRAST_RATIO, REGISTERED_TEXT_BACKGROUND_PAIRS } from "./tokens";

describe("design token contrast", () => {
  it("has at least one registered pair", () => {
    expect(REGISTERED_TEXT_BACKGROUND_PAIRS.length).toBeGreaterThan(0);
  });

  it.each(REGISTERED_TEXT_BACKGROUND_PAIRS)(
    "$name ($usedBy) computes >= 7:1",
    ({ fg, bg }) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    },
  );

  it("agrees with known WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 0);
  });
});
