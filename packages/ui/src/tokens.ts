// Single source of truth: packages/config/design-tokens.json. The Tailwind
// preset (packages/config/tailwind-preset.js) reads the same file, so a
// color changed here is a color changed everywhere.
import designTokens from "@pulse/config/design-tokens.json" with { type: "json" };

export const colors = designTokens.colors;
export const fontSize = designTokens.fontSize;
export const spacingScale = designTokens.spacingScale;

// WCAG 2.x relative luminance / contrast ratio (see
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). Pure function of
// two sRGB hex colors — no DOM, so it runs the same in a vitest node
// environment as in a browser.
function srgbChannelToLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA) + 0.05;
  const lumB = relativeLuminance(hexB) + 0.05;
  return Math.max(lumA, lumB) / Math.min(lumA, lumB);
}

// Every text/background token pair actually used by a component in this
// package. This is the enforcement surface for the "≥7:1 everywhere"
// invariant — a component may only paint text using a pair registered
// here, and the colocated contrast test fails the build the moment a new
// pair drops below AAA (7:1) for normal text.
export interface TokenPair {
  name: string;
  fg: string;
  bg: string;
  usedBy: string;
}

export const REGISTERED_TEXT_BACKGROUND_PAIRS: TokenPair[] = [
  { name: "primary-on-canvas", fg: colors.ink[50], bg: colors.ink[950], usedBy: "page body text" },
  { name: "secondary-on-canvas", fg: colors.ink[300], bg: colors.ink[950], usedBy: "page meta text" },
  { name: "primary-on-surface", fg: colors.ink[50], bg: colors.ink[900], usedBy: "VenueCard, Sheet title" },
  { name: "secondary-on-surface", fg: colors.ink[300], bg: colors.ink[900], usedBy: "Badge lastVerifiedAt, VenueCard subtext" },
  { name: "label-on-chip", fg: colors.ink[100], bg: colors.ink[700], usedBy: "FilterChip unselected" },
  { name: "strong-on-chip", fg: colors.ink[50], bg: colors.ink[700], usedBy: "EmptyState heading, Skeleton label" },
  { name: "selected-chip-label", fg: colors.ink[950], bg: colors.accent.subtle, usedBy: "FilterChip selected" },
  { name: "fresh-label-on-subtle", fg: colors.ink[950], bg: colors.fresh.subtle, usedBy: "Badge (fresh, subtle style)" },
  { name: "ageing-label-on-subtle", fg: colors.ink[950], bg: colors.ageing.subtle, usedBy: "Badge (ageing, subtle style)" },
  { name: "unconfirmed-label-on-subtle", fg: colors.ink[950], bg: colors.unconfirmed.subtle, usedBy: "Badge (unconfirmed, subtle style)" },
  { name: "unconfirmed-label-solid", fg: colors.ink[50], bg: colors.unconfirmed.DEFAULT, usedBy: "Badge (unconfirmed, solid style)" },
];

export const MIN_CONTRAST_RATIO = 7;
