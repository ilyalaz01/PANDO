import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/unit/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/contract/**/*.test.ts",
      "tests/performance/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      // Browser-only development fixtures are exercised by Playwright and are not production code.
      exclude: ["src/app/layout.tsx", "src/app/dev/**"],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
});
