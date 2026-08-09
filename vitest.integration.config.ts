import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest does not read .env. Load it so TEST_DATABASE_URL is available when the
// config below is evaluated; in CI the environment supplies it directly.
try {
  process.loadEnvFile();
} catch {
  // no .env on disk — CI path
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

if (testDatabaseUrl && !/_test(\?|$)/.test(testDatabaseUrl)) {
  throw new Error(
    `Refusing to run the integration suite against '${testDatabaseUrl}': ` +
      `the database name must end in _test. This suite truncates tables.`,
  );
}

/**
 * Database-backed tests: cross-user authorization denial, concurrent auth
 * upsert, uniqueness and transaction behavior, import semantics.
 *
 * These run against a DISPOSABLE database only. Never point this suite at the
 * production candidate.
 */
export default defineConfig({
  // Mirror the `@/*` path alias from tsconfig.json; Vitest does not read it.
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // Shared database state: run files serially rather than fighting over rows.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
    },
  },
});
