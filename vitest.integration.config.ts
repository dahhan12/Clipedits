import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests hit a REAL PostgreSQL (and, where noted, Redis). Run with a
 * loaded environment, e.g.:
 *   set -a; . ./.env; set +a; npm run test:integration
 * They self-skip when DATABASE_URL is absent so unit CI stays green.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.itest.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
