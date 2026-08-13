import { existsSync, rmSync } from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { clerkSetup } from "@clerk/testing/playwright";

export const STORAGE_STATE = "tests/e2e/.auth/state.json";

/**
 * Two setup steps, with very different failure policies.
 *
 * **Clerk testing token.** Only the signed-in specs need it — it suppresses the
 * bot protection that would challenge an automated browser mid-sign-up. It
 * requires a real secret key, so it fails wherever one is deliberately absent,
 * and letting that abort the run would mean the suite could only execute
 * somewhere holding production credentials. So it fails soft.
 *
 * **The invite gate does NOT fail soft**, and that is a correction. It used to,
 * and the consequence was ugly: a poisoned storage state survived between runs,
 * the gate step failed silently, and thirteen specs then failed on their own
 * assertions — a landing page missing its links, protected routes not
 * redirecting — which reads exactly like the application being broken. It cost
 * a real investigation to discover the app was fine.
 *
 * A gate we were asked to pass and could not is a setup failure, and it now says
 * so before a single spec runs.
 */
export default async function globalSetup(config: FullConfig) {
  /**
   * Never reuse a previous run's state. It is written by this function, so it
   * carries no information a fresh run needs — but it CAN carry a stale session
   * or, as happened here, Clerk's redirect-loop counter from a broken
   * deployment, and then poison every spec that follows.
   */
  if (existsSync(STORAGE_STATE)) rmSync(STORAGE_STATE);

  /**
   * Clerk's testing token is set up ONLY for a local target, and that is not a
   * convenience — it is a correctness requirement.
   *
   * `clerkSetup` configures interception against whichever instance the
   * publishable key names, which here is the DEVELOPMENT one. Pointing that at
   * a production host makes the browser carry development Clerk cookies into a
   * production site, and production Clerk answers with a handshake it can never
   * satisfy: a redirect loop, `/invite` never rendering, and thirteen specs
   * failing on assertions about a landing page that was never reached.
   *
   * Only the signed-in specs need the token, and they refuse to run anywhere
   * but a local disposable database — so the two conditions are the same one.
   */
  const targetsLocal =
    (config.projects[0]?.use?.baseURL ?? "").includes("localhost") ||
    (config.projects[0]?.use?.baseURL ?? "").includes("127.0.0.1");

  if (targetsLocal) {
    try {
      await clerkSetup({ publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
    } catch (error) {
      console.warn(
        `[e2e] No Clerk testing token (${error instanceof Error ? error.message.slice(0, 80) : "unknown"}). ` +
          "Anonymous and accessibility specs run normally; signed-in specs need real Clerk credentials.",
      );
    }
  }

  const code = process.env.E2E_INVITE_CODE;
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3100";

  /**
   * A state file is written on EVERY path, including when there is no gate to
   * pass — the config now points at it unconditionally, so a missing file is a
   * hard error in every worker rather than a quiet fallback.
   */
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    if (!code) {
      await context.storageState({ path: STORAGE_STATE });
      return;
    }

    await page.goto("/invite");

    /**
     * The gate may legitimately be off, in which case `/invite` redirects to
     * `/`. Distinguish that from "the page failed to render" by checking where
     * we ended up — treating every missing field as "gate is off" is how a
     * redirect loop got mistaken for a valid state and silently produced a
     * cookieless run.
     */
    const field = page.locator("#code");
    if (!(await field.isVisible().catch(() => false))) {
      const landed = new URL(page.url()).pathname;
      if (landed.startsWith("/invite")) {
        throw new Error(`the gate page rendered no code field (still at ${landed})`);
      }
      await context.storageState({ path: STORAGE_STATE });
      return;
    }

    await field.fill(code);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/invite"), { timeout: 15_000 });

    const cookies = await context.cookies();
    if (!cookies.some((c) => c.name === "tj_invite")) {
      throw new Error("passed the form but no tj_invite cookie was set");
    }

    await context.storageState({ path: STORAGE_STATE });
  } catch (error) {
    throw new Error(
      `[e2e] Could not pass the invite gate at ${baseURL}: ${String(error).slice(0, 160)}. ` +
        "Every spec would fail on its own assertions, which looks like a broken app. " +
        "Check E2E_INVITE_CODE and that the host is up.",
    );
  } finally {
    await browser.close();
  }
}
