import { expect, test, type Page } from "@playwright/test";
import { signUp, testEmail } from "./support/auth";
import { CN_TOWER, importSmallCollection, writeNote } from "./support/notes";

/**
 * Every page, at every width people actually use.
 *
 * Samah kept finding layout faults by hand — a card off the side of a phone, a
 * tag chip with its count sitting lower and larger than its name, controls
 * sitting on top of each other. Those are not judgement calls; they are
 * measurable, and a person should not be the mechanism that discovers them.
 *
 * Three classes of fault are checked, because they are the three that keep
 * happening here:
 *
 *   1. **Sideways spill.** The page must never scroll horizontally.
 *   2. **Overlap.** Two controls must not sit on top of one another, which is
 *      how a dropdown ends up covering the button beside it.
 *   3. **Vertical drift.** Items on one visual row must share a baseline band —
 *      the tag-count bug was a `.note` inside a chip inheriting a larger font
 *      and a top margin, which reads as "the spacing looks weird".
 */

const VIEWPORTS = [
  { name: "laptop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
] as const;

const target = process.env.E2E_BASE_URL ?? "http://localhost:3100";
test.skip(
  !(target.includes("localhost") || target.includes("127.0.0.1")),
  "Creates users, so local disposable databases only.",
);
test.describe.configure({ timeout: 180_000 });

/** How far the document scrolls sideways. Anything above zero is a bug. */
async function sidewaysSpill(page: Page): Promise<{ spill: number; widest: string }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    let widest = "(nothing)";
    let worst = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const over = box.right - doc.clientWidth;
      if (over > worst) {
        worst = over;
        widest = `${el.tagName.toLowerCase()}.${el.className || "(none)"} +${Math.round(over)}px`;
      }
    }
    return { spill: doc.scrollWidth - doc.clientWidth, widest };
  });
}

/**
 * Interactive elements that visually cover one another.
 *
 * Siblings that merely touch are fine; this looks for a genuine intersection of
 * more than a couple of pixels, and ignores ancestor/descendant pairs, which
 * overlap by definition.
 */
async function overlappingControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("a, button, select, input, textarea"),
    ).filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        // A control inside an open <dialog> legitimately sits over the page.
        !el.closest("dialog[open]")
      );
    });

    const describe = (el: HTMLElement) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${el.className || "(none)"}`;

    const found: string[] = [];
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i]!;
        const b = controls[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        // A label wrapping its own input is one control, not two.
        if (a.closest("label") && a.closest("label") === b.closest("label")) continue;

        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (overlapX > 2 && overlapY > 2) {
          found.push(`${describe(a)} over ${describe(b)}`);
        }
      }
    }
    return [...new Set(found)];
  });
}

/**
 * Inline items on one row whose text baselines disagree badly.
 *
 * This is what "the spacing looks weird" turned out to mean: a chip's count
 * inheriting a bigger font and a top margin, so it sat lower and larger than
 * the word beside it.
 */
async function misalignedChipParts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const chip of Array.from(document.querySelectorAll<HTMLElement>(".chip"))) {
      const parent = getComputedStyle(chip);
      for (const child of Array.from(chip.children) as HTMLElement[]) {
        const style = getComputedStyle(child);
        const parentSize = parseFloat(parent.fontSize);
        const childSize = parseFloat(style.fontSize);
        if (childSize > parentSize + 0.5) {
          bad.push(`${chip.className}: child font ${childSize}px > chip ${parentSize}px`);
        }
        const marginTop = parseFloat(style.marginTop);
        if (marginTop > 0.5) {
          bad.push(`${chip.className}: child has ${marginTop}px top margin inside a chip`);
        }
      }
    }
    return [...new Set(bad)];
  });
}

/** Seed enough content that pages are not empty shells. */
async function seed(page: Page): Promise<string> {
  await writeNote(page, { ...CN_TOWER, body: "a note to give the page something to lay out" });
  await page.getByRole("button", { name: /add tags/i }).first().click();
  await page.locator("input[name='tags']").first().fill("qawwali, late night");
  await page.getByRole("button", { name: /save tags/i }).click();
  await expect(page.locator("a.chip.tag").first()).toBeVisible({ timeout: 30_000 });

  await importSmallCollection(page);
  return page.url();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} — no page spills, overlaps or misaligns`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signUp(page, testEmail(`responsive-${viewport.name}`));
    const collectionUrl = await seed(page);

    const pages: Array<[string, string]> = [
      ["notes", "/notes"],
      ["notes, filtered", "/notes?tag=qawwali"],
      ["notes, searched", "/notes?q=note"],
      ["notes, sorted", "/notes?sort=artist&dir=asc"],
      ["collections", "/collections"],
      ["a collection", collectionUrl],
      ["account", "/account"],
      ["about", "/about"],
    ];

    const problems: string[] = [];

    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      const { spill, widest } = await sidewaysSpill(page);
      if (spill > 0) problems.push(`${name}: scrolls sideways by ${spill}px — widest ${widest}`);

      for (const overlap of await overlappingControls(page)) {
        problems.push(`${name}: ${overlap}`);
      }
      for (const misaligned of await misalignedChipParts(page)) {
        problems.push(`${name}: ${misaligned}`);
      }
    }

    expect(problems, `\n  - ${problems.join("\n  - ")}\n`).toEqual([]);
  });
}
