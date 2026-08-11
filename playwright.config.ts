import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level acceptance tests.
 *
 * Only **anonymous-visitor** specs live here for now, and that is a deliberate
 * sequencing decision rather than an omission. Clerk is being replaced with
 * SuperTokens before the invite; a Playwright auth fixture written against Clerk
 * testing tokens would be discarded at that point, and it is the fixture rather
 * than the assertions that would be rewritten. The signed-in happy path and the
 * cross-user privacy path arrive after the migration.
 *
 * What is here does not depend on the auth provider at all: a landing page that
 * renders, protected routes that turn an anonymous visitor away, share URLs that
 * disclose nothing, and the staging host staying unindexed. Those specs survive
 * the migration untouched.
 *
 * `E2E_BASE_URL` points the suite at an already-running server — the deployed
 * staging host, or a locally started production artifact. Without it, the dev
 * server is started automatically.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Skipped when E2E_BASE_URL is set, so the same specs can run against a
  // deployed host without trying to boot a second server underneath it.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
