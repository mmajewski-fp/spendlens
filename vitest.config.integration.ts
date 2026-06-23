import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Ad-hoc, local-only integration suite against real local Supabase (Docker).
// Kept SEPARATE from the unit config so `npm run test` never boots Docker.
// Run via `npm run test:integration` (NOT wired into CI). See test-plan §3/§5.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    env: { TZ: "UTC" }, // determinism (lessons.md): goals future-date refine uses local-time Date
    globalSetup: ["./tests/integration/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000, // first `supabase start` pulls Docker images
    pool: "forks",
    poolOptions: { forks: { singleFork: true } }, // serialize against the one shared DB
    fileParallelism: false,
  },
});
