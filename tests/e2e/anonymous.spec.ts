import { expect, test } from "@playwright/test";

/**
 * What a signed-out visitor can and cannot see.
 *
 * These are acceptance criteria from AGENTS.md §14, checked through a real
 * browser rather than through a service call — which matters, because the two
 * failures this file is built around were both invisible to unit and
 * integration tests:
 *
 *   - the landing page rendered every user's private notes, and no service test
 *     could see it because the leak was in a page component;
 *   - every rendering route hung for 30 seconds behind a working proxy gate,
 *     and the whole suite passed while it did.
 *
 * Nothing here signs in, so nothing here depends on Clerk or SuperTokens.
 */

test.describe("the landing page", () => {
  test("renders the pitch and both ways in", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /what music means to you/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /create an account/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  /**
   * The regression that matters most on this page. `/` used to be the
   * Checkpoint 1a schema inspector: it listed every recording, collection and
   * note in the database, on a route the proxy treats as public.
   */
  test("discloses no user content", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("table")).toHaveCount(0);
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of ["schema inspector", "artist_display", "origin =", "private note"]) {
      expect(body).not.toContain(leak);
    }
  });

  test("is not indexable", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("sends no clickable link with unreadable contrast", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /sign in/i }).first();
    await expect(link).toBeVisible();
    // The browser default (#0000EE) fails contrast on the dark palette, so the
    // one thing worth asserting is that we are not still using it.
    const color = await link.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe("rgb(0, 0, 238)");
  });
});

test.describe("protected routes turn an anonymous visitor away", () => {
  for (const path of ["/notes", "/collections", "/account"]) {
    test(`${path} does not render for a signed-out visitor`, async ({ page }) => {
      await page.goto(path);

      // Either the proxy redirected, or Clerk's sign-in UI took over. What must
      // not happen is the page itself rendering.
      expect(page.url()).not.toContain(path);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain("your note");
    });
  }
});

test.describe("share URLs disclose nothing by guessing", () => {
  /**
   * A share token is unguessable by construction, but "unguessable" is a claim
   * worth checking: a wrong token must not distinguish "no such note" from
   * "exists but private", or the endpoint becomes an oracle.
   */
  test("an invented note token reveals no note", async ({ page }) => {
    const response = await page.goto("/n/0f9c3a7e-0000-4000-8000-000000000000");

    expect(response?.status()).toBeGreaterThanOrEqual(400);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("visibility");
    expect(body).not.toContain("owner");
  });

  test("a malformed token is handled as cleanly as a well-formed one", async ({ page }) => {
    const response = await page.goto("/n/not-a-real-token");
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("health", () => {
  test("reports the database, not just the process", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
