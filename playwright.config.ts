import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level acceptance tests.
 *
 * Two kinds of spec, split by where they are allowed to run.
 *
 * **Anonymous specs** touch nothing and create nothing, so they run against
 * whatever `E2E_BASE_URL` points at — including the deployed staging host,
 * which is the only way to check that the *deployed* thing behaves.
 *
 * **Signed-in specs create users, notes and collections**, so they are confined
 * to a local disposable database and skip themselves against any remote host.
 * That is the rule from CLAUDE.md: integration and E2E run against disposable
 * local or CI databases, and a deployed environment gets narrow smoke tests
 * with dedicated accounts only. A suite that seeds fixtures into the same
 * database real testers are using is not a test, it is a data-integrity
 * problem waiting to be discovered.
 */

/**
 * `localhost`, not `127.0.0.1`, and the difference is not cosmetic.
 *
 * `next dev` binds `localhost` and refuses cross-origin requests to its dev
 * assets — a browser loading the page from `http://127.0.0.1:3100` sends that
 * as its Origin, Next considers it a different origin, and every JS chunk comes
 * back **403**. The page then renders its server HTML and hydrates nothing, so
 * Clerk's sign-in form simply never appears and the failure looks like a
 * missing selector.
 *
 * This is the same 127.0.0.1-vs-localhost distinction that caused the
 * production proxy loop, arriving through a completely different mechanism.
 * Worth stating twice.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",

  // Obtains a Clerk testing token so an automated browser is not challenged by
  // bot protection. Harmless when no signed-in spec runs.
  globalSetup: "./tests/e2e/support/global-setup.ts",

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
        url: "http://localhost:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
