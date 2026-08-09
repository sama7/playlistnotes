import { describe, expect, it } from "vitest";
import { parseSpotifyLink, parseSpotifyTrack } from "./parse-link";

// Real IDs, verified against Spotify's oEmbed endpoint on 2026-08-08.
const CN_TOWER = "4u43I0LP2Xf85OAS85eG0R";
const SSSFU_ALBUM = "6Rl6YoCarF2GHPSQmmFjuR";
const DRAKE = "3TVXtAsR1Inumwj472S9r4";

describe("parseSpotifyLink — accepted forms", () => {
  it("parses a canonical track URL", () => {
    expect(parseSpotifyLink(`https://open.spotify.com/track/${CN_TOWER}`)).toEqual({
      kind: "track",
      id: CN_TOWER,
      canonicalUrl: `https://open.spotify.com/track/${CN_TOWER}`,
    });
  });

  it("parses the spotify: URI form", () => {
    expect(parseSpotifyLink(`spotify:track:${CN_TOWER}`)).toMatchObject({
      kind: "track",
      id: CN_TOWER,
    });
  });

  /** Spotify really serves these, and users really paste them. */
  it("parses a locale-prefixed URL", () => {
    expect(parseSpotifyLink(`https://open.spotify.com/intl-pt/track/${CN_TOWER}`)).toMatchObject({
      kind: "track",
      id: CN_TOWER,
    });
  });

  it("tolerates a missing scheme", () => {
    expect(parseSpotifyLink(`open.spotify.com/track/${CN_TOWER}`)).toMatchObject({
      kind: "track",
      id: CN_TOWER,
    });
  });

  it("tolerates surrounding whitespace from a sloppy paste", () => {
    expect(parseSpotifyLink(`  https://open.spotify.com/track/${CN_TOWER}\n`)).toMatchObject({
      kind: "track",
      id: CN_TOWER,
    });
  });

  /** `si` identifies the person who shared the link. We have no use for it. */
  it("discards share tokens and other query parameters", () => {
    const ref = parseSpotifyLink(
      `https://open.spotify.com/track/${CN_TOWER}?si=abc123&utm_source=copy-link&nd=1`,
    );
    expect(ref).toMatchObject({ canonicalUrl: `https://open.spotify.com/track/${CN_TOWER}` });
    expect(JSON.stringify(ref)).not.toContain("si=");
  });

  it("recognises albums and artists distinctly", () => {
    expect(parseSpotifyLink(`https://open.spotify.com/album/${SSSFU_ALBUM}`)).toMatchObject({
      kind: "album",
    });
    expect(parseSpotifyLink(`https://open.spotify.com/artist/${DRAKE}`)).toMatchObject({
      kind: "artist",
    });
  });

  it("recognises short links without resolving them inline", () => {
    expect(parseSpotifyLink("https://spotify.link/aBcDeFg")).toEqual({
      kind: "short-link",
      url: "https://spotify.link/aBcDeFg",
    });
  });
});

describe("parseSpotifyLink — playlists are recognised in order to be refused", () => {
  /**
   * AGENTS.md §4.4: a playlist link never creates a collection or an item. It
   * has to be identified before it can be refused, and it must not be mistaken
   * for something unparseable — the user deserves an explanation, not an error.
   */
  it("identifies a playlist as a playlist", () => {
    expect(parseSpotifyLink("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6")).toEqual({
      kind: "playlist",
      id: "37i9dQZF1DX4WYpdgoIcn6",
      canonicalUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
    });
  });

  it("refuses a playlist from the track helper, preserving why", () => {
    const result = parseSpotifyTrack("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.ref.kind).toBe("playlist");
  });
});

describe("parseSpotifyLink — refusals", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["not a url at all", "not-a-url"],
    ["javascript:alert(1)", "wrong-scheme"],
    ["data:text/html;base64,PHNjcmlwdD4=", "wrong-scheme"],
    ["file:///etc/passwd", "wrong-scheme"],
  ])("refuses %j as %s", (input, reason) => {
    expect(parseSpotifyLink(input)).toEqual({ kind: "unsupported", reason });
  });

  /**
   * The SSRF surface. Every one of these is a plausible attempt to make the
   * server fetch something it should not, and each must die at parse time —
   * before any network call is contemplated.
   */
  it.each([
    "https://evil.com/track/4u43I0LP2Xf85OAS85eG0R",
    "https://open.spotify.com.evil.com/track/4u43I0LP2Xf85OAS85eG0R",
    "https://openspotify.com/track/4u43I0LP2Xf85OAS85eG0R",
    "https://open.spotify.com.attacker.io/track/4u43I0LP2Xf85OAS85eG0R",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:5432/track/4u43I0LP2Xf85OAS85eG0R",
    "http://127.0.0.1/track/4u43I0LP2Xf85OAS85eG0R",
    "http://[::1]/track/4u43I0LP2Xf85OAS85eG0R",
  ])("refuses non-Spotify host %s", (input) => {
    expect(parseSpotifyLink(input)).toEqual({ kind: "unsupported", reason: "wrong-host" });
  });

  it("refuses an embedded-credentials URL pointing elsewhere", () => {
    expect(parseSpotifyLink("https://open.spotify.com@evil.com/track/x")).toMatchObject({
      kind: "unsupported",
    });
  });

  it.each([
    "https://open.spotify.com/track/short",
    "https://open.spotify.com/track/waytoolongtobeaspotifyidentifier",
    "https://open.spotify.com/track/has-a-hyphen-in-it-xx",
    "spotify:track:nope",
  ])("refuses malformed id in %s", (input) => {
    expect(parseSpotifyLink(input)).toEqual({ kind: "unsupported", reason: "malformed-id" });
  });

  it("refuses entity types we do not handle", () => {
    expect(parseSpotifyLink("https://open.spotify.com/episode/4u43I0LP2Xf85OAS85eG0R")).toEqual({
      kind: "unsupported",
      reason: "unsupported-entity",
    });
    expect(parseSpotifyLink("https://open.spotify.com/user/someone")).toEqual({
      kind: "unsupported",
      reason: "unsupported-entity",
    });
  });

  it("refuses a bare host with no path", () => {
    expect(parseSpotifyLink("https://open.spotify.com")).toEqual({
      kind: "unsupported",
      reason: "unknown-path",
    });
  });
});
