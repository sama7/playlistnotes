import { describe, expect, it } from "vitest";
import { parseAppleMusicLink } from "./parse-link";

// Real Apple catalogue IDs, verified against the live iTunes API 2026-08-10.
const ALBUM = "1796475285"; // $ome $exy $ongs 4 U
const TRACK = "1796475286"; // CN TOWER
const ARTIST = "666648192"; // PARTYNEXTDOOR & Drake (one entity in Apple's catalogue)

describe("parseAppleMusicLink — accepted forms", () => {
  /**
   * The quirk that matters: a track is an ALBUM url carrying ?i=. Dropping
   * query parameters wholesale — correct for Spotify's ?si= — would silently
   * turn every pasted track into its album.
   */
  it("reads a track from the ?i= parameter, not the path", () => {
    expect(
      parseAppleMusicLink(`https://music.apple.com/us/album/ome-exy-ongs-4-u/${ALBUM}?i=${TRACK}`),
    ).toEqual({
      kind: "track",
      id: TRACK,
      albumId: ALBUM,
      canonicalUrl: `https://music.apple.com/album/${ALBUM}?i=${TRACK}`,
    });
  });

  it("reads an album when ?i= is absent", () => {
    expect(
      parseAppleMusicLink(`https://music.apple.com/us/album/ome-exy-ongs-4-u/${ALBUM}`),
    ).toMatchObject({ kind: "album", id: ALBUM });
  });

  it("strips the storefront, including regional variants", () => {
    for (const store of ["us", "gb", "pt-br", "ja"]) {
      expect(
        parseAppleMusicLink(`https://music.apple.com/${store}/album/slug/${ALBUM}`),
      ).toMatchObject({ kind: "album", id: ALBUM });
    }
  });

  it("works with no storefront at all", () => {
    expect(parseAppleMusicLink(`https://music.apple.com/album/slug/${ALBUM}`)).toMatchObject({
      kind: "album",
      id: ALBUM,
    });
  });

  it("accepts the legacy itunes.apple.com host", () => {
    expect(parseAppleMusicLink(`https://itunes.apple.com/us/album/slug/${ALBUM}`)).toMatchObject({
      kind: "album",
    });
  });

  it("recognises artists and playlists distinctly", () => {
    expect(parseAppleMusicLink(`https://music.apple.com/us/artist/pnd/${ARTIST}`)).toMatchObject({
      kind: "artist",
      id: ARTIST,
    });
    expect(
      parseAppleMusicLink("https://music.apple.com/us/playlist/chill/pl.u-aZb00rMt2gPXqe"),
    ).toMatchObject({ kind: "playlist", id: "pl.u-aZb00rMt2gPXqe" });
  });

  it("tolerates whitespace and a missing scheme", () => {
    expect(parseAppleMusicLink(`  music.apple.com/us/album/slug/${ALBUM}  `)).toMatchObject({
      kind: "album",
    });
  });
});

describe("parseAppleMusicLink — refusals", () => {
  it.each([
    ["", "empty"],
    ["not a url", "not-a-url"],
    ["javascript:alert(1)", "wrong-scheme"],
  ])("refuses %j as %s", (input, reason) => {
    expect(parseAppleMusicLink(input)).toEqual({ kind: "unsupported", reason });
  });

  it.each([
    "https://music.apple.com.evil.com/us/album/slug/1796475285",
    "https://evil.com/us/album/slug/1796475285",
    "http://169.254.169.254/us/album/slug/1796475285",
    "http://127.0.0.1/us/album/slug/1796475285",
  ])("refuses non-Apple host %s", (input) => {
    expect(parseAppleMusicLink(input)).toEqual({ kind: "unsupported", reason: "wrong-host" });
  });

  it.each([
    `https://music.apple.com/us/album/slug/not-numeric`,
    `https://music.apple.com/us/album/slug/${ALBUM}?i=not-numeric`,
    `https://music.apple.com/us/playlist/name/not-a-playlist-id`,
  ])("refuses malformed id in %s", (input) => {
    expect(parseAppleMusicLink(input)).toEqual({ kind: "unsupported", reason: "malformed-id" });
  });

  it("refuses entity types we do not handle", () => {
    expect(
      parseAppleMusicLink("https://music.apple.com/us/podcast/some-show/1234567890"),
    ).toEqual({ kind: "unsupported", reason: "unsupported-entity" });
  });
});
