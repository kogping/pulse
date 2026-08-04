/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Neutral scale — the base for background/text/border across both apps.
        ink: {
          950: "#0b0d10",
          900: "#12161b",
          700: "#2a323b",
          500: "#5b6672",
          300: "#a7b0b9",
          100: "#e7eaed",
          50: "#f6f7f8",
        },
        // Confidence colors mirror packages/db's Confidence union
        // (fresh | ageing | unconfirmed) 1:1 — this is the one color
        // mapping every attribute display in both apps must agree on.
        fresh: { DEFAULT: "#1c8a5c", subtle: "#e3f6ec" },
        ageing: { DEFAULT: "#b3790a", subtle: "#fbf0da" },
        unconfirmed: { DEFAULT: "#8a1c2e", subtle: "#f8e3e6" },
        accent: { DEFAULT: "#3a5ef5", subtle: "#e7ecfe" },
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
