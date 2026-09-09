import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * Nothing may scroll sideways on a phone.
 *
 * These render real markup against the real stylesheet rather than driving the
 * app, because the bugs they catch live in CSS and reproducing them through the
 * product needs a signed-in account, a connected Last.fm and fresh scrobbles —
 * conditions a test cannot conjure and a person should not have to recreate to
 * find out that a card spills off the screen.
 *
 * This is the second horizontal-overflow bug in this project; the collection
 * tracklist was the first. Both were invisible on a laptop and obvious on a
 * phone, which is exactly the kind of thing a test should be watching for.
 */

const NARROW = { width: 402, height: 874 }; // iPhone 16 Pro
const NARROWEST = { width: 320, height: 640 }; // the smallest we support

async function stylesheet(): Promise<string> {
  return readFile("app/globals.css", "utf8");
}

/** Mount markup with the app's real CSS and report any sideways spill. */
async function overflowOf(
  page: import("@playwright/test").Page,
  body: string,
  viewport: { width: number; height: number },
): Promise<{ documentOverflow: number; widest: string | null }> {
  await page.setViewportSize(viewport);
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${await stylesheet()}</style></head><body>${body}</body></html>`,
  );

  return page.evaluate(() => {
    const doc = document.documentElement;
    const documentOverflow = doc.scrollWidth - doc.clientWidth;

    // Name the widest offender, so a failure says what to go and look at
    // rather than only that something is too wide.
    let widest: string | null = null;
    let worst = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const spill = el.getBoundingClientRect().right - doc.clientWidth;
      if (spill > worst) {
        worst = spill;
        widest = `${el.tagName.toLowerCase()}.${el.className || "(no class)"} +${Math.round(spill)}px`;
      }
    }
    return { documentOverflow, widest };
  });
}

/** The picker that spilled: a fieldset of radio rows with covers and long text. */
const MATCH_PICKER = `
<main><ul class="scrobble-list"><li class="scrobble">
  <div class="scrobble-main">
    <div class="scrobble-title"><a href="#">Rasiya</a></div>
    <div class="note">Anyasa · rasiya</div>
    <div class="note scrobble-when">Sep 8, 2026, 11:50 PM</div>
  </div>
  <form class="scrobble-jot inline-edit">
    <fieldset class="sub-fields match-picker">
      <legend>Is this the one?</legend>
      <p class="note">Last.fm didn't include an identifier for this play. Confirming a match gets you the cover art and links, and files it alongside the same track from anywhere else. Nothing is matched for you.</p>
      <label class="match">
        <input type="radio" checked>
        <span class="cover cover-empty" style="width:44px;height:44px"></span>
        <span class="match-text">
          <strong>Rasiya</strong>
          <span class="note">Anyasa, Isheeta Chakrvarty · Gaya EP</span>
          <span class="note">Apple Music · within 0.9s</span>
        </span>
      </label>
      <label class="match match-none">
        <input type="radio">
        <span class="match-text">
          <strong>None of these</strong>
          <span class="note">Keep it as your own entry — private to you, and no cover art.</span>
        </span>
      </label>
    </fieldset>
    <textarea rows="3" placeholder="What do you want to remember about Rasiya?"></textarea>
    <div class="row">
      <button type="submit">Save jot</button>
      <button type="button" class="linkish">Cancel</button>
      <span class="note">Dated Sep 8, 2026, 11:50 PM</span>
    </div>
  </form>
</li></ul></main>`;

/** The note editor, which uses the same fieldsets for date and place. */
const NOTE_EDITOR = `
<main><ul class="notes"><li class="note-card">
  <form class="inline-edit">
    <textarea rows="4"></textarea>
    <fieldset class="sub-fields">
      <legend>When you heard it</legend>
      <p class="note">Leave this empty for "now". A gig in 2011 is dated 2011, not today.</p>
      <div class="row">
        <div class="field"><label>Date</label><input type="date"></div>
        <div class="field"><label>How sure</label><select><option>That day</option></select></div>
      </div>
    </fieldset>
    <fieldset class="sub-fields">
      <legend>Where you were</legend>
      <div class="field"><label>Place</label><input placeholder="A city, a venue, someone's kitchen"></div>
      <label class="checkbox"><input type="checkbox"><span>Remember this precisely. Otherwise only the name above is kept — no coordinates.</span></label>
    </fieldset>
  </form>
</li></ul></main>`;

test.describe("narrow viewports", () => {
  for (const [name, markup] of [
    ["the scrobble match picker", MATCH_PICKER],
    ["the note editor's date and place fields", NOTE_EDITOR],
  ] as const) {
    test(`${name} does not spill sideways on a phone`, async ({ page }) => {
      const { documentOverflow, widest } = await overflowOf(page, markup, NARROW);
      expect(documentOverflow, `widest offender: ${widest}`).toBeLessThanOrEqual(0);
    });

    test(`${name} does not spill sideways at 320px`, async ({ page }) => {
      const { documentOverflow, widest } = await overflowOf(page, markup, NARROWEST);
      expect(documentOverflow, `widest offender: ${widest}`).toBeLessThanOrEqual(0);
    });
  }

  /**
   * The picker must stay *readable*, not merely contained — collapsing every
   * row to an ellipsis would pass an overflow check while being useless.
   */
  /** Ellipsing prose hid the half that says what the choice actually does. */
  test("the opt-out explains itself in full rather than being truncated", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.setContent(
      `<!doctype html><html><head><style>${await stylesheet()}</style></head><body>${MATCH_PICKER}</body></html>`,
    );

    const optOut = page.locator("label.match-none .note");
    const clipped = await optOut.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    );
    expect(clipped, "the opt-out text is cut off").toBe(false);
    await expect(optOut).toContainText("no cover art");
  });

  test("each candidate still shows its title and provider on a phone", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.setContent(
      `<!doctype html><html><head><style>${await stylesheet()}</style></head><body>${MATCH_PICKER}</body></html>`,
    );

    const first = page.locator("label.match").first();
    await expect(first.locator("strong")).toHaveText("Rasiya");
    const box = await first.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(NARROW.width);
  });
});
