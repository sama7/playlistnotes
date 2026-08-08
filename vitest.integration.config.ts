import { defineConfig } from "vitest/config";

/**
 * Database-backed tests: cross-user authorization denial, concurrent auth
 * upsert, uniqueness and transaction behavior, import semantics.
 *
 * These run against a DISPOSABLE database only — TEST_DATABASE_URL, which must
 * end in `_test`. Never point this suite at the production candidate.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Shared database state: run files serially rather than fighting over rows.
    fileParallelism: false,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    },
  },
});
