import { describe, expect, it, vi } from "vitest";
import { findTrackCandidates } from "./match-track";

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
