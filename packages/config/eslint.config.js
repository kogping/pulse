const preset = require("./eslint-preset.js");

module.exports = [
  ...preset,
  // Consumers get CJS globals for these via the preset's `**/*.config.js`
  // override; here they're plain top-level files, not *.config.js, so they
  // fall outside that override and need the same relaxation directly.
  {
    files: ["eslint-preset.js", "tailwind-preset.js"],
    languageOptions: {
      globals: { require: "readonly", module: "writable" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
];
