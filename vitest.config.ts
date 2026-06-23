import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pin the timezone so date math in the engine (local-time Date math)
    // is deterministic even under a direct `vitest` run, not just the
    // TZ=UTC npm scripts. See reviews/impl-review.md F1.
    env: { TZ: "UTC" },
  },
});
