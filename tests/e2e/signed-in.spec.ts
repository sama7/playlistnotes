import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Result } from "axe-core";
import { signIn, signUp, testEmail } from "./support/auth";
import { CN_TOWER, DARLING_I, importSmallCollection, writeNote } from "./support/notes";

/**
 * The signed-in happy path and the privacy path, through a real browser.
 *
 * These create users, notes and collections, so they run **only** against a
 * local disposable database. Pointed at a deployed host they skip themselves
 * rather than seeding fixtures into a database real testers are using.
 *
 * What they cover that integration tests cannot: the wiring between Clerk's
 * components, the proxy gate, the lazy local-user upsert, and Server Actions.
 * Each of those is a seam where the pieces can be individually correct and the
 * assembly still broken — exactly the class of failure that shipped a hanging
 * artifact past a green suite.
 */

const target = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const isLocal = target.includes("localhost") || target.includes("127.0.0.1");

test.skip(
  !isLocal,
  "Signed-in specs create data, so they run only against a local disposable database.",
);

// Sign-up involves a real verification round trip; the default 30s is not enough.
test.describe.configure({ timeout: 120_000 });

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Print what failed. A bare count is useless when this fails in CI. */
function report(violations: Result[]): void {
  if (violations.length === 0) return;
  console.log(
    violations
      .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes[0]?.html ?? ""}`)
      .join("\n"),
  );
}

test.describe("the core loop", () => {
  test("sign up, write a note, and see it listed", async ({ page }) => {
    await signUp(page, testEmail("core"));
    await expect(page.getByRole("heading", { name: /your notes/i })).toBeVisible();

    await writeNote(page, { ...CN_TOWER, body: "The city sounds under the intro." });

    await expect(page.getByText("CN TOWER").first()).toBeVisible();
  });

  test("a new note is private by default", async ({ page }) => {
    await signUp(page, testEmail("private"));
    await writeNote(page, { ...DARLING_I, body: "private by default, always" });

    // The visibility chip is the user-facing promise, so assert what the person
    // actually sees rather than the column behind it.
    await expect(page.locator(".chip.private").first()).toBeVisible();
  });

  test("signing out revokes access to the notes page", async ({ page }) => {
    await signUp(page, testEmail("signout"));
    await page.getByRole("button", { name: /sign out/i }).first().click();

    /**
     * Sign-out is asynchronous: Clerk clears the session and then navigates.
     * Navigating to /notes before that settles reads the old session and the
     * assertion fails for a reason that has nothing to do with the gate. Wait
     * for the signed-out landing page — the CTA only renders when there is no
     * session — before testing what a signed-out visitor can reach.
     */
    await expect(page.getByRole("button", { name: /create an account/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/notes");
    expect(page.url()).not.toContain("/notes");
  });

  /**
   * The retention behaviour the product rests on: leave, come back, find your
   * note. It also proves the lazy upsert resolves the SAME local row on a second
   * sign-in rather than creating a second one — the failure that would silently
   * split someone's journal in half.
   */
  test("a returning user finds their note still there", async ({ page, browser }) => {
    const email = testEmail("returning");
    await signUp(page, email);
    await writeNote(page, { ...CN_TOWER, body: "still here when I come back" });

    const later = await browser.newContext();
    const laterPage = await later.newPage();
    await signIn(laterPage, email);

    await expect(laterPage.getByText("still here when I come back")).toBeVisible({
      timeout: 30_000,
    });
    await later.close();
  });

  test("search finds a note by its body", async ({ page }) => {
    await signUp(page, testEmail("search"));
    await writeNote(page, { ...CN_TOWER, body: "the toronto skyline at four in the morning" });

    await page.locator("#q").fill("skyline");
    await page.getByRole("button", { name: /^search$/i }).click();

    await expect(page.getByText("the toronto skyline at four in the morning")).toBeVisible();
  });
});

test.describe("the privacy path", () => {
  /**
   * The acceptance criterion through a browser: one user's private note is
   * invisible to a *different signed-in user*, not merely to anonymous
   * visitors. Integration tests assert this at the service layer; this asserts
   * nothing in the rendered page leaks it.
   */
  test("a second signed-in user sees none of the first user's notes", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const alice = await aliceContext.newPage();
    await signUp(alice, testEmail("alice"));

    const SECRET = "alices private sentence that bob must never see";
    await writeNote(alice, { ...CN_TOWER, body: SECRET });

    // A separate context: no shared cookies, no shared storage.
    const bobContext = await browser.newContext();
    const bob = await bobContext.newPage();
    await signUp(bob, testEmail("bob"));

    await expect(bob.getByRole("heading", { name: /nothing yet/i })).toBeVisible();
    expect(await bob.locator("body").innerText()).not.toContain(SECRET);

    // Search is the other route to someone else's writing. It is scoped in the
    // query rather than filtered afterwards, so it must return nothing.
    await bob.goto(`/notes?q=${encodeURIComponent("private sentence")}`);
    expect(await bob.locator("body").innerText()).not.toContain(SECRET);

    await bobContext.close();
    await aliceContext.close();
  });

  test("an anonymous visitor cannot reach a private note by guessing", async ({
    page,
    browser,
  }) => {
    await signUp(page, testEmail("guess"));
    await writeNote(page, { ...CN_TOWER, body: "not shared with anyone" });

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    const response = await anonPage.goto("/n/0f9c3a7e-0000-4000-8000-000000000000");
    expect(response?.status()).toBeGreaterThanOrEqual(400);
    expect(await anonPage.locator("body").innerText()).not.toContain("not shared with anyone");
    await anon.close();
  });
});

/**
 * The visibility control had two bugs that made it look like it worked while
 * doing nothing: React 19 reset the uncontrolled select after each Server
 * Action, and once controlled, the form serialised its FormData after React had
 * restored the DOM value — so every change after the first submitted the
 * previous value. Both were invisible to a test that changed it once.
 */
test.describe("sharing is deliberate", () => {
  test("visibility survives being changed several times in a row", async ({ page }) => {
    await signUp(page, testEmail("visibility"));
    await writeNote(page, { ...CN_TOWER, body: "toggled through every audience" });

    const select = page.locator("select[name='visibility']").first();

    for (const [value, chip] of [
      ["unlisted", ".chip.unlisted"],
      ["public", ".chip.public"],
      ["private", ".chip.private"],
    ] as const) {
      await select.selectOption(value);
      await expect(page.locator(chip).first()).toBeVisible({ timeout: 30_000 });
      // The control must agree with what was actually saved, or the next change
      // is made from a baseline the user cannot see.
      await expect(select).toHaveValue(value);
    }

    await page.reload();
    await expect(page.locator("select[name='visibility']").first()).toHaveValue("private");
  });

  test("a note is unreachable until published, then reachable, then revoked", async ({
    page,
    browser,
  }) => {
    await signUp(page, testEmail("share"));
    await writeNote(page, { ...CN_TOWER, body: "deliberately shared, then taken back" });

    // One control, three audiences — the token is an implementation detail, so
    // the test drives the same select a person does.
    await page.locator("select[name='visibility']").first().selectOption("unlisted");
    await expect(page.locator(".chip.unlisted").first()).toBeVisible({ timeout: 30_000 });

    /**
     * The URL is no longer printed on the page — it is on a copy button, whose
     * accessible name carries it. Reading it from there is also the assertion
     * that a screen-reader user can still reach the link.
     */
    const copy = page.getByRole("button", { name: /copy link/i }).first();
    const shareUrl = (await copy.getAttribute("title")) ?? "";
    expect(shareUrl).toContain("/n/");

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(shareUrl);
    await expect(anonPage.getByText("deliberately shared, then taken back")).toBeVisible();

    // Going private must revoke, not merely stop advertising the link.
    await page.locator("select[name='visibility']").first().selectOption("private");
    await expect(page.locator(".chip.private").first()).toBeVisible({ timeout: 30_000 });

    const after = await anonPage.goto(shareUrl);
    expect(after?.status()).toBeGreaterThanOrEqual(400);

    await anon.close();
  });
});

test.describe("accessibility of the signed-in surfaces", () => {
  /**
   * The anonymous pages are nearly static; these are where the real complexity
   * lives — a capture form, inline editors, chips, a tracklist, a share panel.
   * Axe finds perhaps a third of real problems, so this is a floor, not a claim
   * the pages are pleasant with a screen reader. That pass is still manual.
   */
  test("the notes page has no detectable violations, empty or populated", async ({ page }) => {
    await signUp(page, testEmail("a11y"));

    const empty = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    report(empty.violations);
    expect(empty.violations).toEqual([]);

    await writeNote(page, { ...CN_TOWER, body: "a note with tags and a share control" });

    const populated = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    report(populated.violations);
    expect(populated.violations).toEqual([]);
  });

  test("the collections page has no detectable violations", async ({ page }) => {
    await signUp(page, testEmail("a11y-collections"));
    await page.goto("/collections");

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    report(results.violations);
    expect(results.violations).toEqual([]);
  });

  /**
   * Repeated controls in a list need distinguishable accessible names.
   * Listing the buttons on a fifty-track playlist and hearing "Add a note"
   * fifty times is technically conformant and practically useless.
   */
  test("per-track controls name the track they belong to", async ({ page }) => {
    await signUp(page, testEmail("a11y-labels"));
    await importSmallCollection(page);

    /**
     * The controls live in the row's details panel, which CSS hides on a narrow
     * viewport. Accessible names are what is being asserted, not visibility, so
     * the count is taken from the accessibility tree.
     */
    const addButtons = page.getByRole("button", { name: /^Add a note about .+/ });
    expect(await addButtons.count()).toBeGreaterThan(0);
  });

  test("a collection page has no detectable violations once it has tracks", async ({
    page,
  }) => {
    await signUp(page, testEmail("a11y-tracklist"));
    await importSmallCollection(page);

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    report(results.violations);
    expect(results.violations).toEqual([]);
  });
});

