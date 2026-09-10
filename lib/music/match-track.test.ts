import { describe, expect, it, vi } from "vitest";
import { findTrackCandidates, isPlausibleMatch } from "./match-track";

/**
 * Ranking possible matches for something known only by name.
 *
 * The case that matters is the real one: "Rasiya" by Anyasa exists as an
 * original, an extended mix and a DJ mix, all sharing a title. A string
 * comparison cannot separate them; length separates them decisively, and
 * Last.fm supplies a length far more often than it supplies an identifier.
 */

const APPLE = {
  results: [
    {
      trackId: 1574601348,
      trackName: "Rasiya",
      artistName: "Anyasa",
      collectionId: 1574601347,
      collectionName: "Rasiya",
      trackTimeMillis: 228865,
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
    },
    {
      trackId: 1574601350,
      trackName: "Rasiya (Extended Mix)",
      artistName: "Anyasa",
      collectionId: 1574601347,
      collectionName: "Rasiya",
      trackTimeMillis: 440652,
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
    },
  ],
};

function stubFetch(apple: unknown) {
  vi.stubGlobal("fetch", (async (url: URL | string) => {
    const href = url.toString();
    if (href.includes("itunes.apple.com")) {
      return new Response(JSON.stringify(apple));
    }
    // Spotify unconfigured in this suite; searchSpotifyTracks returns [].
    return new Response("{}", { status: 500 });
  }) as unknown as typeof fetch);
}

describe("ranking candidates", () => {
  it("puts the take whose length matches first", async () => {
    stubFetch(APPLE);

    const found = await findTrackCandidates({
      title: "Rasiya",
      artistName: "Anyasa",
      durationMs: 228000,
    });

    expect(found[0]!.providerId).toBe("1574601348");
    expect(found[0]!.durationDeltaMs).toBe(865);
    // The extended mix is kept, not discarded — it may be what they heard.
    expect(found.map((c) => c.providerId)).toContain("1574601350");
    expect(found[0]!.score).toBeGreaterThan(found[1]!.score);
  });

  it("carries an identifier, a link and artwork for each candidate", async () => {
    stubFetch(APPLE);
    const [best] = await findTrackCandidates({
      title: "Rasiya",
      artistName: "Anyasa",
      durationMs: 228000,
    });

    expect(best!.provider).toBe("apple_music");
    expect(best!.artwork.url).toContain("mzstatic.com");
    expect(best!.providerUrl).toBe("https://music.apple.com/album/id1574601347?i=1574601348");
  });

  /** Without a length there is nothing to separate the takes, and it says so. */
  it("still ranks by name when no duration is known", async () => {
    stubFetch(APPLE);
    const found = await findTrackCandidates({
      title: "Rasiya",
      artistName: "Anyasa",
      durationMs: null,
    });

    expect(found).toHaveLength(2);
    expect(found.every((c) => c.durationDeltaMs === null)).toBe(true);
  });

  it("returns nothing rather than throwing when a provider is unreachable", async () => {
    vi.stubGlobal("fetch", (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);

    await expect(
      findTrackCandidates({ title: "Rasiya", artistName: "Anyasa", durationMs: 228000 }),
    ).resolves.toEqual([]);
  });

  it("asks for nothing when there is nothing to search for", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl as unknown as typeof fetch);

    expect(await findTrackCandidates({ title: "", artistName: "", durationMs: null })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * The floor: what is allowed to appear at all.
 *
 * These are the actual rows the picker offered for a scrobble of "206" by Joe
 * James. Every one of them came back from a provider's search for those words,
 * scored zero or less, and was shown anyway — which is what made the whole
 * list look untrustworthy, including the row that was right.
 */
describe("the relevance floor", () => {
  const KNOWN = { title: "206", artistName: "Joe James", durationMs: null };

  const NOISE = {
    results: [
      {
        trackId: 1,
        trackName: "206",
        artistName: "Joe James",
        collectionId: 10,
        collectionName: "The Ends, Never Ends",
        trackTimeMillis: 180000,
        artworkUrl100: "https://example.test/a/100x100bb.jpg",
      },
      {
        trackId: 2,
        trackName: "Last Day (feat. Juicy J, Lloyd Banks)",
        artistName: "Joe Budden",
        collectionId: 11,
        collectionName: "No Love Lost",
        trackTimeMillis: 240000,
        artworkUrl100: "https://example.test/b/100x100bb.jpg",
      },
      {
        trackId: 3,
        trackName: "Petit prince",
        artistName: "Sadek",
        collectionId: 12,
        collectionName: "#VVRDL",
        trackTimeMillis: 200000,
        artworkUrl100: "https://example.test/c/100x100bb.jpg",
      },
    ],
  };

  it("shows the track and nothing else", async () => {
    stubFetch(NOISE);

    const found = await findTrackCandidates(KNOWN);

    expect(found.map((c) => c.title)).toEqual(["206"]);
  });

  it("rejects an artist sharing only a first name", () => {
    expect(
      isPlausibleMatch({ title: "206", artistName: "Joe Budden" }, KNOWN),
    ).toBe(false);
  });

  it("rejects a different song entirely", () => {
    expect(
      isPlausibleMatch({ title: "Petit prince", artistName: "Sadek" }, KNOWN),
    ).toBe(false);
  });

  /** Catalogues append; they do not prepend. */
  it("accepts material added to the end of a title", () => {
    const known = { title: "Rasiya", artistName: "Anyasa" };
    expect(isPlausibleMatch({ title: "Rasiya (Extended Mix)", artistName: "Anyasa" }, known)).toBe(true);
    expect(isPlausibleMatch({ title: "Rasiya - Live", artistName: "Anyasa" }, known)).toBe(true);
    // ...but a title that merely CONTAINS the words is not the same song.
    expect(isPlausibleMatch({ title: "Ode to Rasiya", artistName: "Anyasa" }, known)).toBe(false);
  });

  /** A collaboration is credited in whichever order each service prefers. */
  it("accepts a collaborator listed in either order", () => {
    const known = { title: "Rasiya", artistName: "Anyasa" };
    expect(isPlausibleMatch({ title: "Rasiya", artistName: "Anyasa & Kabeer" }, known)).toBe(true);
    expect(isPlausibleMatch({ title: "Rasiya", artistName: "Kabeer, Anyasa" }, known)).toBe(true);
  });

  /**
   * The deliberate non-rule: a wildly different length does NOT disqualify.
   * An extended mix is the same song, and may be the one that was heard.
   */
  it("keeps a long alternate cut, ranked below the matching one", async () => {
    stubFetch(APPLE);

    const found = await findTrackCandidates({
      title: "Rasiya",
      artistName: "Anyasa",
      durationMs: 228000,
    });

    expect(found.map((c) => c.providerId)).toEqual(["1574601348", "1574601350"]);
  });

  it("offers nothing rather than something wrong", async () => {
    stubFetch({ results: NOISE.results.slice(1) });

    expect(await findTrackCandidates(KNOWN)).toEqual([]);
  });
});
