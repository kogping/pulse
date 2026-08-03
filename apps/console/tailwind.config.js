const preset = require("@pulse/config/tailwind-preset.js");

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    "./app/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};
