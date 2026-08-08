import { defineConfig } from "vitest/config";

/**
 * Unit tests only. These must never touch a database.
 * Database-backed tests live in vitest.integration.config.ts and run against a
 * disposable local or CI database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "app/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "tests/integration/**", "tests/e2e/**"],
  },
});
