import { expect, type Page } from "@playwright/test";

/**
 * Write one note through the capture form.
 *
 * Selectors are pinned to element ids rather than label text. `getByLabel(/your
 * note/i)` matched both the note textarea and the search box ("Search your
 * notes"), which is the sort of ambiguity that grows as a page does — an id is
 * stable and unambiguous, and these are our own elements rather than a third
 * party's.
 *
 * The title and artist are supplied deliberately. With no provider credential
 * in a local environment, capture degrades to asking for the artist, and that
 * degraded path is the one the independence guarantee rests on — so exercising
 * it here is the point rather than a workaround.
 */
export async function writeNote(
  page: Page,
  note: { link: string; body: string; title: string; artist: string },
): Promise<void> {
  await page.locator("#link").fill(note.link);
  await page.locator("#body").fill(note.body);

  const details = page.locator("details", { hasText: /title and artist/i }).first();
  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").click();
  }
  await page.locator("#title").fill(note.title);
  await page.locator("#artistDisplay").fill(note.artist);

  await page.getByRole("button", { name: /^save$/i }).first().click();
  await expect(page.getByText(note.body)).toBeVisible({ timeout: 30_000 });
}

/** A real Spotify track, used only as a well-formed identifier to parse. */
export const CN_TOWER = {
  link: "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R",
  title: "CN TOWER",
  artist: "PARTYNEXTDOOR & Drake",
};

export const DARLING_I = {
  link: "https://open.spotify.com/track/0VaeksJaXy5R1nvcTMh3Xk",
  title: "Darling, I",
  artist: "Tyler, The Creator",
};
