const preset = require("@pulse/config/eslint-preset.js");

module.exports = [
  ...preset,
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: { self: "readonly", caches: "readonly", fetch: "readonly", URL: "readonly" },
    },
  },
  {
    ignores: ["next-env.d.ts"],
  },
];
