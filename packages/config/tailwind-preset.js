const tokens = require("./design-tokens.json");

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      // Colors, font sizes, and the confidence palette all come from
      // design-tokens.json — the same file packages/ui/src/tokens.ts reads
      // to build its contrast-checked pair registry. Change a hex value in
      // exactly one place.
      colors: tokens.colors,
      fontSize: tokens.fontSize,
      fontFamily: {
        // apps/web sets --font-sans via next/font (display: swap); the
        // system stack after it is what renders until that font loads, so
        // first paint is never blocked on a webfont download.
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      spacing: {
        // Safe-area insets, for fixed/sticky chrome (action bars, toasts)
        // on notched phones — apps/console's queue is used one-thumb,
        // outdoors, with a fixed bottom action row.
        "safe-t": "env(safe-area-inset-top, 0px)",
        "safe-b": "env(safe-area-inset-bottom, 0px)",
        "safe-l": "env(safe-area-inset-left, 0px)",
        "safe-r": "env(safe-area-inset-right, 0px)",
      },
      minHeight: {
        // Minimum touch target per WCAG 2.5.5 / Material Design (48px) —
        // every tappable control in the verification queue must clear this.
        touch: "48px",
      },
      minWidth: {
        touch: "48px",
      },
    },
  },
  plugins: [],
};
