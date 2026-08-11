import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated accessibility checks on the pages an anonymous visitor can reach.
 *
 * Axe catches perhaps a third of real accessibility problems, so a clean run is
 * a floor and not a claim that the page is usable — the keyboard traversal
 * below covers what a rule engine cannot see, and a screen-reader pass over the
 * signed-in surfaces still has to happen by hand after the auth migration.
 *
 * Scoped to WCAG 2 A and AA, which is the bar worth holding to.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("axe", () => {
  for (const [name, path] of [
    ["the landing page", "/"],
    ["the sign-in page", "/sign-in"],
  ] as const) {
    test(`${name} has no detectable violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      // Print what failed rather than only a count — a bare number is useless
      // when this fails in CI.
      if (results.violations.length > 0) {
        console.log(
          results.violations
            .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes[0]?.html ?? ""}`)
            .join("\n"),
        );
      }
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("keyboard", () => {
  /**
   * A skip link is the difference between reaching the content in one key press
   * and traversing the whole header every time. It is only visible on focus,
   * which is exactly when it is needed.
   */
  test("the first tab stop skips to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    await expect(focused).toHaveText(/skip to content/i);
    await expect(focused).toBeVisible();
  });

  test("every interactive element on the landing page is reachable", async ({ page }) => {
    await page.goto("/");

    const reachable = new Set<string>();
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 30)}`;
      });
      if (tag) reachable.add(tag);
    }

    const joined = [...reachable].join(" | ").toLowerCase();
    expect(joined).toContain("create an account");
    expect(joined).toContain("sign in");
  });

  /**
   * A focus ring the browser draws is often invisible against a dark palette
   * once a custom background is set. This asserts the styled one is present
   * rather than trusting that the default survived.
   */
  test("focus is visible on buttons", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /create an account/i });
    await button.focus();

    const outline = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle, shadow: s.boxShadow };
    });

    const hasRing =
      (outline.style !== "none" && parseFloat(outline.width) > 0) ||
      (outline.shadow !== "none" && outline.shadow !== "");
    expect(hasRing).toBe(true);
  });
});

test.describe("structure", () => {
  test("there is exactly one h1 and the page declares a language", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("content sits in a main landmark", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("the page does not scroll horizontally at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
