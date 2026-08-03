import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATTRIBUTE_CLASSES, DECAY_RULES, type AttributeClass, type Confidence, attributeConfidence } from "./freshness";
import { generateMigrationSql } from "./freshness.sql";

describe("attribute_confidence SQL stays in lockstep with freshness.ts", () => {
  it("checked-in migration matches a fresh render of the decay-rules table", () => {
    const checkedIn = readFileSync(
      path.join(import.meta.dirname, "../migrations/0001_attribute_confidence.sql"),
      "utf-8",
    );
    expect(checkedIn).toBe(generateMigrationSql());
  });
});

// Re-implements the decay decision in plain terms (not by importing the
// production thresholds as magic numbers) so this doubles as a spec for
// attributeConfidence(), not just a change-detector.
function expectedConfidence(cls: AttributeClass, ageHours: number, flagCount: number): Confidence {
  const { freshHours, ageingHours } = DECAY_RULES[cls];
  if (flagCount >= 2) return "unconfirmed";
  let base: Confidence = ageHours <= freshHours ? "fresh" : ageHours <= ageingHours ? "ageing" : "unconfirmed";
  if (flagCount >= 1 && base === "fresh") base = "ageing";
  return base;
}

describe("attributeConfidence matrix", () => {
  const now = new Date("2026-08-04T12:00:00Z");
  const classes = Object.keys(DECAY_RULES) as AttributeClass[];
  const flagCounts = [0, 1, 2, 3];

  for (const cls of classes) {
    const { freshHours, ageingHours } = DECAY_RULES[cls];
    // Sample just inside/outside each boundary, plus zero.
    const sampleAges = [0, freshHours, freshHours + 0.01, ageingHours, ageingHours + 0.01, ageingHours * 2];
    const attributeKey = Object.entries(ATTRIBUTE_CLASSES).find(([, c]) => c === cls)?.[0];
    if (!attributeKey) throw new Error(`no fixture attribute for class ${cls}`);

    for (const ageHours of sampleAges) {
      for (const flagCount of flagCounts) {
        it(`${cls} attribute at age=${ageHours}h flags=${flagCount}`, () => {
          const lastVerifiedAt = new Date(now.getTime() - ageHours * 60 * 60 * 1000);
          const actual = attributeConfidence({ attributeKey, lastVerifiedAt, flagCount, now });
          expect(actual).toBe(expectedConfidence(cls, ageHours, flagCount));
        });
      }
    }
  }

  it("falls back to the default class for an unmapped attribute key", () => {
    const result = attributeConfidence({
      attributeKey: "some_future_attribute",
      lastVerifiedAt: now,
      flagCount: 0,
      now,
    });
    expect(result).toBe("fresh");
  });
});
