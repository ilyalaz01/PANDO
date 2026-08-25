import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;

const port = 3107;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node ./scripts/e2e-server.mjs ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
