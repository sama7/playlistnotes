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
 * Six classes of fault are checked, because these are the ones that keep
 * happening here — each one added the day a person found it by eye:
 *
 *   1. **Sideways spill.** The page must never scroll horizontally.
 *   2. **Overlap.** Two controls must not sit on top of one another, which is
 *      how a dropdown ends up covering the button beside it.
 *   3. **Vertical drift.** Items on one visual row must share a baseline band —
 *      the tag-count bug was a `.note` inside a chip inheriting a larger font
 *      and a top margin, which reads as "the spacing looks weird".
 *   4. **Stranded text.** A box given a height must centre what is in it.
 *   5. **Margins fighting a row.** A flex row spaces its children with `gap`;
 *      a child's own block margin only knocks it out of line.
 *   6. **Clipped placeholders.** Text that cannot wrap must fit its box.
 *
 * And all of it now runs with a **touch pointer** on the tablet and phone,
 * which it did not before — see `VIEWPORTS`.
 */

/**
 * `touch` is not decoration — it decides whether a whole stylesheet block runs.
 *
 * These tests only ever called `setViewportSize`, which changes the width and
 * nothing else. `@media (pointer: coarse)` therefore never matched, so the
 * touch rules — the ones that raise controls to a tap target — were never
 * exercised at any width. That is precisely where the tag-chip fault lived: a
 * chip given a 2.75rem min-height for touch, with its text still sitting at the
 * top of the box. The suite reported three clean viewports because it was
 * measuring a phone-width desktop, which is not a phone.
 */
const VIEWPORTS = [
  { name: "laptop", width: 1440, height: 900, touch: false },
  { name: "tablet", width: 768, height: 1024, touch: true },
  { name: "phone", width: 390, height: 844, touch: true },
] as const;

const target = process.env.E2E_BASE_URL ?? "http://localhost:3100";
test.skip(
  !(target.includes("localhost") || target.includes("127.0.0.1")),
  "Creates users, so local disposable databases only.",
);
test.describe.configure({ timeout: 180_000 });

/** How far the document scrolls sideways. Anything above zero is a bug. */
async function sidewaysSpill(
  page: Page,
): Promise<{ spill: number; widest: string }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    let widest = "(nothing)";
    let worst = 0;
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )) {
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
      document.querySelectorAll<HTMLElement>(
        "a, button, select, input, textarea",
      ),
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
        if (a.closest("label") && a.closest("label") === b.closest("label"))
          continue;

        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const overlapX =
          Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const overlapY =
          Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
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
    for (const chip of Array.from(
      document.querySelectorAll<HTMLElement>(".chip"),
    )) {
      const parent = getComputedStyle(chip);
      for (const child of Array.from(chip.children) as HTMLElement[]) {
        const style = getComputedStyle(child);
        const parentSize = parseFloat(parent.fontSize);
        const childSize = parseFloat(style.fontSize);
        if (childSize > parentSize + 0.5) {
          bad.push(
            `${chip.className}: child font ${childSize}px > chip ${parentSize}px`,
          );
        }
        const marginTop = parseFloat(style.marginTop);
        if (marginTop > 0.5) {
          bad.push(
            `${chip.className}: child has ${marginTop}px top margin inside a chip`,
          );
        }
      }
    }
    return [...new Set(bad)];
  });
}

/**
 * Text stranded at the top or bottom of a box that was given a height.
 *
 * A control handed a `min-height` it did not ask for — a tap target, usually —
 * has to centre its own contents, and `display: inline-block` does not. The
 * result is a tall pill with its word near the top, which reads to a person as
 * "the spacing looks weird" rather than as any nameable defect.
 *
 * Measured off the text itself with a Range, so it holds however the centring
 * is achieved, and only for single-line content where centring is unambiguous.
 */
async function strandedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )) {
      const style = getComputedStyle(el);
      // `min-height: auto` parses to NaN, and `NaN <= 0` is false — so a naive
      // check here measured every element on the page rather than the few that
      // were given a height. Ask the positive question instead.
      const floor = parseFloat(style.minHeight);
      if (!(floor > 0)) continue;
      if (!el.textContent?.trim()) continue;

      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      if (text.height === 0 || box.height === 0) continue;
      // Multi-line content has no single right answer; skip it.
      if (text.height > parseFloat(style.lineHeight || "0") * 1.6) continue;

      const above = text.top - box.top;
      const below = box.bottom - text.bottom;
      if (Math.abs(above - below) > 4) {
        bad.push(
          `${el.tagName.toLowerCase()}.${el.className || "(none)"}: text sits ` +
            `${Math.round(above)}px from the top and ${Math.round(below)}px from the bottom`,
        );
      }
    }
    return [...new Set(bad)];
  });
}

/**
 * A block margin on a child of a horizontal flex row.
 *
 * These rows space their children with `gap` and level them with
 * `align-items: center`, so a child's own top margin does nothing except push
 * it out of line with everything beside it. This is one root cause with three
 * symptoms: "Sort" sitting below its dropdowns, "Dated now" sitting below
 * "Cancel", and "Tags" sitting below the tag chips — all of them a `.note`,
 * whose paragraph margin is correct underneath something and wrong beside it.
 *
 * Only row-direction containers are checked. A margin in a flex *column* is
 * ordinary and often deliberate.
 */
async function marginsInRows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const row of Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )) {
      const style = getComputedStyle(row);
      if (style.display !== "flex" && style.display !== "inline-flex") continue;
      if (style.flexDirection.startsWith("column")) continue;
      if (style.alignItems !== "center") continue;

      for (const child of Array.from(row.children) as HTMLElement[]) {
        const childStyle = getComputedStyle(child);
        const top = parseFloat(childStyle.marginTop);
        const bottom = parseFloat(childStyle.marginBottom);
        if (top > 0.5 || bottom > 0.5) {
          bad.push(
            `${child.tagName.toLowerCase()}.${child.className || "(none)"} has a ` +
              `${Math.round(top)}/${Math.round(bottom)}px block margin inside a centred row`,
          );
        }
      }
    }
    return [...new Set(bad)];
  });
}

/**
 * Placeholder text wider than the box holding it.
 *
 * A placeholder is the one string in a form that cannot wrap, cannot ellipsize
 * and cannot be scrolled to — it is simply cut mid-word, which on a phone made
 * "A Spotify or Apple Music track, album or playlist" render as "A Spotify or
 * Apple Music trac". None of the earlier checks could see it: nothing overflows
 * the page, nothing overlaps, and the clipping happens inside the input's own
 * box. It has to be measured against the font to be found at all.
 */
async function clippedPlaceholders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];

    const bad: string[] = [];
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      ),
    );
    for (const field of fields) {
      const text = field.placeholder;
      if (!text) continue;
      // A textarea wraps, so a long placeholder there is not clipped.
      if (field.tagName === "TEXTAREA") continue;

      const style = getComputedStyle(field);
      if (style.display === "none" || style.visibility === "hidden") continue;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

      const needed = ctx.measureText(text).width;
      const available =
        field.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      if (available > 0 && needed > available + 1) {
        bad.push(
          `${field.id || field.name || "input"}: placeholder needs ` +
            `${Math.round(needed)}px in a ${Math.round(available)}px box — “${text}”`,
        );
      }
    }
    return [...new Set(bad)];
  });
}

/** Seed enough content that pages are not empty shells. */
async function seed(page: Page): Promise<string> {
  await writeNote(page, {
    ...CN_TOWER,
    body: "a note to give the page something to lay out",
  });
  await page
    .getByRole("button", { name: /add tags/i })
    .first()
    .click();
  await page.locator("input[name='tags']").first().fill("qawwali, late night");
  await page.getByRole("button", { name: /save tags/i }).click();
  await expect(page.locator("a.chip.tag").first()).toBeVisible({
    timeout: 30_000,
  });

  await importSmallCollection(page);
  return page.url();
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    // Set on the context, not the page: `hasTouch` is what makes
    // `pointer: coarse` match, and it cannot be changed after the context
    // exists the way a viewport can.
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
    });

    test(`${viewport.name} — no page spills, overlaps or misaligns`, async ({
      page,
    }) => {
      await expect
        .poll(() =>
          page.evaluate(() => matchMedia("(pointer: coarse)").matches),
        )
        .toBe(viewport.touch);
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
        /**
         * Wait for the content, not for the network to go quiet.
         *
         * `waitForLoadState("networkidle")` hung here and timed the whole test
         * out at three minutes. On a signed-in page the network never *is* idle —
         * Clerk polls in the background, and the recently-played strip polls
         * Last.fm — so the condition can simply never arrive. Playwright
         * discourages it for exactly this reason. A visible landmark is the thing
         * actually being waited for.
         */
        await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

        const { spill, widest } = await sidewaysSpill(page);
        if (spill > 0)
          problems.push(
            `${name}: scrolls sideways by ${spill}px — widest ${widest}`,
          );

        for (const overlap of await overlappingControls(page)) {
          problems.push(`${name}: ${overlap}`);
        }
        for (const misaligned of await misalignedChipParts(page)) {
          problems.push(`${name}: ${misaligned}`);
        }
        for (const stranded of await strandedText(page)) {
          problems.push(`${name}: ${stranded}`);
        }
        for (const margin of await marginsInRows(page)) {
          problems.push(`${name}: ${margin}`);
        }
        for (const clipped of await clippedPlaceholders(page)) {
          problems.push(`${name}: ${clipped}`);
        }
      }

      expect(problems, `\n  - ${problems.join("\n  - ")}\n`).toEqual([]);
    });
  });
}
