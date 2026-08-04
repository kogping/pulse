import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "e2e/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
