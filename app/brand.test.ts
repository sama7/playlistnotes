import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The product is called TrackJot everywhere a user can see it.
 *
 * A rename is the kind of change that ships 95% done: the landing page gets
 * updated, and then a share page, an error message, or a page title keeps the
 * old name for months because nobody visits that route while looking for it.
 * This asserts the user-facing surfaces directly, so a partial rebrand fails
 * here instead of being discovered by someone else.
 *
 * **Historical references are deliberately allowed and must stay.** v1 really
 * was called Playlistnotes, and it is still running on that name. Statements
 * about the Heroku app, the legacy database, the pre-rename repository, or the
 * old domain describe facts, and rewriting them would make the documentation
 * lie about its own past. Only the files below — the ones that render — are
 * held to the new name.
 */

const appDir = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

/** Files whose contents reach a user's screen. */
const USER_FACING = [
  "layout.tsx",
  "page.tsx",
  "n/[token]/page.tsx",
  "c/[token]/page.tsx",
  "notes/capture-form.tsx",
  "collections/import-form.tsx",
];

describe("the rebrand is complete on every user-facing surface", () => {
  for (const file of USER_FACING) {
    it(`${file} shows no trace of the old name`, async () => {
      const source = await readFile(`${appDir}${file}`, "utf8");
      expect(source).not.toMatch(/playlistnotes/i);
    });
  }

  it("the document title is TrackJot", async () => {
    const layout = await readFile(`${appDir}layout.tsx`, "utf8");
    expect(layout).toContain('title: "TrackJot"');
  });

  it("shared pages attribute to TrackJot", async () => {
    for (const file of ["n/[token]/page.tsx", "c/[token]/page.tsx"]) {
      const source = await readFile(`${appDir}${file}`, "utf8");
      expect(source).toContain("Shared from TrackJot");
    }
  });
});

describe("outbound identity", () => {
  /**
   * The short-link resolver announces itself to Spotify. It is the one string
   * this product sends to somebody else's server, so it naming the wrong
   * product is a small but real misrepresentation.
   */
  it("the user agent names TrackJot and its own domain", async () => {
    const source = await readFile(`${root}/lib/music/spotify/resolve-short-link.ts`, "utf8");
    expect(source).toMatch(/TrackJot\/\d/);
    expect(source).toContain("trackjot.com");
    expect(source).not.toMatch(/playlistnotes/i);
  });

  it("the package is named trackjot", async () => {
    const pkg = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
    expect(pkg.name).toBe("trackjot");
  });
});
