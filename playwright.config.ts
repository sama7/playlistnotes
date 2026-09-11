import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./tests/e2e/support/global-setup";

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

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /**
         * Always this path — global setup guarantees the file exists, even when
         * it holds no cookies.
         *
         * It used to be `existsSync(...) ? ... : undefined`, which is a trap:
         * this config is evaluated BEFORE global setup runs, so the check asks
         * whether a *previous* run left a file. Delete that file and the gate
         * cookie silently stops being applied; leave it and a stale session
         * leaks between runs. Both failure modes surface as specs failing on
         * their own assertions, which looks like a broken application.
         */
        storageState: STORAGE_STATE,
      },
    },
    /**
     * The layout specs again, in WebKit and in the dark.
     *
     * Both halves of that are a fix for something that reached production.
     *
     * **WebKit**, because Samah uses iOS Safari and the fault he found was a
     * date input painted straight through the select beside it — and
     * `<input type="date">` is the single control where intrinsic sizing
     * differs most between engines. A Chromium-only sweep is structurally
     * unable to see it.
     *
     * **Dark**, because native control chrome — a select's chevron, a date
     * picker, a checkbox tick — is drawn by the UA and not by the stylesheet.
     * Testing only the light theme tests the one theme where a missing
     * `color-scheme` declaration looks perfectly fine.
     *
     * Scoped to the layout specs by `testMatch` rather than run across the
     * whole suite: this is about how things are painted, and paying for a
     * second full pass of the auth and privacy specs would buy nothing.
     */
    {
      name: "webkit-layout",
      /**
       * The stylesheet harness only — **not** the signed-in sweep.
       *
       * The signed-in specs cannot run in WebKit against Clerk's *development*
       * instance: it lives on a different origin (`…accounts.dev`) from the app
       * under test, WebKit's cookie policy will not carry the handshake across
       * that boundary, and sign-up spins between redirect URLs until the test
       * times out. Production's Clerk is first-party on `clerk.trackjot.com`,
       * so this is a property of the test setup rather than a defect anyone
       * would hit — but it does mean WebKit coverage has to come from markup
       * that needs no session.
       *
       * That costs nothing worth having. What WebKit uniquely reveals is
       * intrinsic control widths and native chrome, and `narrow-layout.spec.ts`
       * renders the real stylesheet against real markup with no server at all.
       */
      testMatch: /narrow-layout\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        colorScheme: "dark",
      },
    },
  ],

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
