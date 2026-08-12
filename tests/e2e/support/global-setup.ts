import { chromium, type FullConfig } from "@playwright/test";
import { clerkSetup } from "@clerk/testing/playwright";

export const STORAGE_STATE = "tests/e2e/.auth/state.json";

/**
 * Two setup steps, both allowed to fail without taking the suite with them.
 *
 * **Clerk testing token.** Only the signed-in specs need it — it suppresses the
 * bot protection that would challenge an automated browser mid-sign-up. It
 * requires a real secret key, so it fails wherever one is deliberately absent.
 * Letting that abort the run would mean the suite could only ever execute
 * somewhere holding production credentials, which is the opposite of what a CI
 * check is for.
 *
 * **The invite gate.** A gated host bounces every public page to /invite, so
 * without this the anonymous specs would fail on a working site. Passing the
 * gate through the real form once and saving the cookie is exactly what a
 * tester does, and it keeps the specs themselves ignorant of whether the gate
 * is even on.
 */
export default async function globalSetup(config: FullConfig) {
  try {
    await clerkSetup({ publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
  } catch (error) {
    console.warn(
      `[e2e] No Clerk testing token (${error instanceof Error ? error.message.slice(0, 80) : "unknown"}). ` +
        "Anonymous and accessibility specs run normally; signed-in specs need real Clerk credentials.",
    );
  }

  const code = process.env.E2E_INVITE_CODE;
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!code || !baseURL) return;

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    await page.goto("/invite");
    // The gate may be off, in which case /invite redirects away and there is
    // nothing to submit. That is a valid state, not a failure.
    if (await page.locator("#code").isVisible().catch(() => false)) {
      await page.locator("#code").fill(code);
      await page.getByRole("button", { name: /continue/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/invite"), { timeout: 15_000 });
    }
    await context.storageState({ path: STORAGE_STATE });
  } catch (error) {
    console.warn(`[e2e] Could not pass the invite gate: ${String(error).slice(0, 120)}`);
  } finally {
    await browser.close();
  }
}
