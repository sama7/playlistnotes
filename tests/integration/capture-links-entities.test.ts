import { PrismaClient, Provider } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureFromLink } from "@/lib/music/capture-track";
import { importCollection } from "@/lib/music/import-collection";
import { fromSpotifyCollection } from "@/lib/music/importable";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Pasting one track link must produce the same row as importing the album it
 * came from.
 *
 * It did not used to. Single-track capture went through an oEmbed-only path that
 * stored a title and a display string and linked nothing, while collection
 * import linked artists, albums and ISRCs from provider IDs. The same song was
 * therefore a rich row or a bare one depending on which door it came in by, and
 * the difference was invisible until someone asked why an artist page would be
 * missing half its tracks.
 *
 * Both paths now go through `resolveImportableTrack`. These tests assert that at
 * the database level rather than trusting the shared call site.
 */

const TRACK_ID = "4u43I0LP2Xf85OAS85eG0R";
const ALBUM_ID = "6Rl6YoCarF2GHPSQmmFjuR";
const PND = { id: "2HPaUgqeutzr3jx5a9WyDd", name: "PARTYNEXTDOOR" };
const DRAKE = { id: "3TVXtAsR1Inumwj472S9r4", name: "Drake" };

const spotifyTrack = {
  id: TRACK_ID,
  name: "CN TOWER",
  artists: [PND, DRAKE],
  artistDisplay: "PARTYNEXTDOOR, Drake",
  durationMs: 189_000,
  isrc: "USUG12403756",
  album: {
    id: ALBUM_ID,
    name: "$OME $EXY $ONGS 4 U",
    artists: [PND, DRAKE],
    releaseDate: "2025-02-14",
  },
  trackNumber: 4,
};

const appleTrack = {
  id: "1795321826",
  name: "CN TOWER",
  artistName: "PARTYNEXTDOOR & Drake",
  artistId: "666648192",
  albumId: "1795321820",
  albumName: "$OME $EXY $ONGS 4 U",
  durationMs: 189_000,
  trackNumber: 4,
  releaseDate: "2025-02-14",
};

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a pasted Spotify track link links real entities", () => {
  it("links every credited artist, the album, and the ISRC", async () => {
    const capture = await captureFromLink(`https://open.spotify.com/track/${TRACK_ID}`, {
      fetchTrackImpl: vi.fn().mockResolvedValue(spotifyTrack),
    });

    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(capture.linked).toBe(true);

    const recording = await prisma.recording.findUniqueOrThrow({
      where: { id: capture.recording.id },
      include: {
        artists: { orderBy: { position: "asc" }, include: { artist: true } },
        album: { include: { artists: true } },
        externalIds: true,
      },
    });

    // Two artists, not one row holding a joined string. This is the difference
    // that makes an artist page possible later.
    expect(recording.artists.map((a) => a.artist.name)).toEqual(["PARTYNEXTDOOR", "Drake"]);
    expect(recording.album?.title).toBe("$OME $EXY $ONGS 4 U");
    expect(recording.album?.artists).toHaveLength(2);
    expect(recording.externalIds[0]?.isrc).toBe("USUG12403756");
    expect(recording.durationMs).toBe(189_000);

    // The credit string is preserved verbatim alongside the entities, never
    // reconstructed from them.
    expect(recording.artistDisplay).toBe("PARTYNEXTDOOR, Drake");
  });

  it("creates artists from provider IDs, so a second track reuses them", async () => {
    await captureFromLink(`https://open.spotify.com/track/${TRACK_ID}`, {
      fetchTrackImpl: vi.fn().mockResolvedValue(spotifyTrack),
    });
    await captureFromLink("https://open.spotify.com/track/1Az1QoedRFrbaxRKKPuJ2X", {
      fetchTrackImpl: vi.fn().mockResolvedValue({
        ...spotifyTrack,
        id: "1Az1QoedRFrbaxRKKPuJ2X",
        name: "GIMME A HUG",
        artists: [DRAKE],
        artistDisplay: "Drake",
        isrc: "USUG12403757",
      }),
    });

    // Drake appears on both; one row, because identity came from the ID.
    expect(await prisma.artist.count()).toBe(2);
    expect(await prisma.recording.count()).toBe(2);
  });
});

describe("capture and import agree about the same track", () => {
  /**
   * A definition-of-done item: repeated occurrences of one track — however it
   * arrives — resolve to exactly one recording.
   */
  it("pasting the track then importing its album yields one recording", async () => {
    const owner = await prisma.user.create({
      data: { authSubject: `s_${crypto.randomUUID()}` },
    });

    const capture = await captureFromLink(`https://open.spotify.com/track/${TRACK_ID}`, {
      fetchTrackImpl: vi.fn().mockResolvedValue(spotifyTrack),
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const summary = await importCollection(
      owner.id,
      fromSpotifyCollection({
        id: ALBUM_ID,
        kind: "album",
        name: "$OME $EXY $ONGS 4 U",
        description: null,
        artists: [PND, DRAKE],
        ownerName: null,
        releaseDate: "2025-02-14",
        tracks: [spotifyTrack],
        truncated: false,
      }),
    );

    // Matched, not created — the import recognised the row capture had written.
    expect(summary.matched).toBe(1);
    expect(summary.created).toBe(0);
    expect(await prisma.recording.count()).toBe(1);

    const item = await prisma.collectionItem.findFirstOrThrow();
    expect(item.recordingId).toBe(capture.recording.id);
  });
});

describe("a pasted Apple Music track link links entities too", () => {
  it("stores the Apple identifiers and links what Apple gives us", async () => {
    const capture = await captureFromLink(
      "https://music.apple.com/us/album/cn-tower/1795321820?i=1795321826",
      { fetchAppleTrackImpl: vi.fn().mockResolvedValue(appleTrack) },
    );

    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const recording = await prisma.recording.findUniqueOrThrow({
      where: { id: capture.recording.id },
      include: { artists: { include: { artist: true } }, album: true, externalIds: true },
    });

    expect(recording.externalIds[0]?.provider).toBe(Provider.apple_music);
    expect(recording.externalIds[0]?.providerId).toBe("1795321826");
    expect(recording.album?.title).toBe("$OME $EXY $ONGS 4 U");

    /**
     * One artist, deliberately. The public iTunes lookup flattens a
     * collaboration into a single credit string plus one id, so "PARTYNEXTDOOR
     * & Drake" arrives as one entity. Splitting that string to manufacture a
     * second artist is exactly what the catalog policy forbids — entities come
     * from identifiers, never from names. The full relationship is available
     * from the catalog API, which needs a developer token.
     */
    expect(recording.artists).toHaveLength(1);
    expect(recording.artistDisplay).toBe("PARTYNEXTDOOR & Drake");
  });

  it("keeps the Spotify and Apple rows distinct until something links them", async () => {
    await captureFromLink(`https://open.spotify.com/track/${TRACK_ID}`, {
      fetchTrackImpl: vi.fn().mockResolvedValue(spotifyTrack),
    });
    await captureFromLink(
      "https://music.apple.com/us/album/cn-tower/1795321820?i=1795321826",
      { fetchAppleTrackImpl: vi.fn().mockResolvedValue(appleTrack) },
    );

    /**
     * Two rows for the same song, and that is the correct behaviour today: a
     * false merge is worse than a duplicate. Nothing yet proves these are the
     * same recording — the ISRC would, but iTunes does not return one — so they
     * stay separate rather than being guessed together.
     */
    expect(await prisma.recording.count()).toBe(2);
  });
});
