import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./tests/e2e/support/paths";

/**
 * Playwright config for SpendLens (Astro 6 SSR).
 *
 * The app runs against a fault-injection proxy (tests/e2e/support/e2e-server.mjs):
 * everything flows to the real local Supabase EXCEPT the transactions read for the
 * designated fault user, which lets the "SSR error surface" risk (test-plan.md #7)
 * be exercised against a genuinely running app — real auth, routing, and SSR render.
 *
 * Auth is cookie-based (Supabase SSR). The `setup` project logs in ONCE via the UI
 * and saves a storageState; specs authenticate from that, never through the UI.
 * Requires local Supabase running (`npx supabase start`).
 */
const PORT = 4399;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /support\/auth\.setup\.ts$/,
      teardown: "cleanup",
    },
    {
      name: "cleanup",
      testMatch: /support\/auth\.teardown\.ts$/,
    },
    {
      name: "chromium",
      testIgnore: /support\//,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
  webServer: {
    command: "node tests/e2e/support/e2e-server.mjs",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
