import { PrismaClient, Provider } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importFromAppleLink } from "@/lib/music/import-from-apple";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Apple Music album and playlist import.
 *
 * Apple exposes two catalogues with very different entry requirements, and the
 * split is the point of most of these tests:
 *
 *   - **Albums** work through the public iTunes lookup with no account at all.
 *     The cost is fidelity: iTunes flattens a collaboration into one credit
 *     string and one artist id.
 *   - **Playlists** exist only in the catalog API, behind a signed developer
 *     token. There is no public fallback, so without one this must refuse and
 *     say why rather than failing vaguely.
 *
 * Verified against the live API on 2026-08-11: a catalog playlist returned 50
 * tracks, every one carrying artist relationships and an ISRC, with
 * collaborations split into separate entities — "KAROL G & Bruno Mars" arriving
 * as two artists with their own ids. Notably Apple serves its **editorial**
 * playlists, which Spotify withholds from Development Mode apps.
 */

const appleAlbum = {
  id: "1839574264",
  name: "ICEMAN",
  artistName: "Drake",
  artistId: "271256",
  releaseDate: "2025-09-05",
  tracks: [
    {
      id: "1839574270",
      name: "What Did I Miss?",
      artistName: "Drake",
      artistId: "271256",
      albumId: "1839574264",
      albumName: "ICEMAN",
      durationMs: 205_000,
      trackNumber: 1,
      releaseDate: "2025-09-05",
    },
  ],
};

const applePlaylist = {
  provider: Provider.apple_music,
  providerId: "pl.f4d106fed2bd41149aaacabb233eb5eb",
  kind: "playlist" as const,
  name: "Today's Hits",
  description: null,
  sourceUrl: "https://music.apple.com/playlist/pl.f4d106fed2bd41149aaacabb233eb5eb",
  truncated: false,
  tracks: [
    {
      providerId: "1826354120",
      name: "Still",
      // The credit exactly as Apple presents it, never split…
      artistDisplay: "KAROL G & Bruno Mars",
      // …alongside the entities Apple actually relates it to.
      artists: [
        { providerId: "290814601", name: "KAROL G" },
        { providerId: "278873078", name: "Bruno Mars" },
      ],
      durationMs: 201_000,
      isrc: "USUM72500001",
      trackNumber: 1,
      album: null,
    },
  ],
};

async function makeUser() {
  return prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Apple album import, with no developer account", () => {
  it("imports through the public iTunes lookup", async () => {
    const user = await makeUser();

    const result = await importFromAppleLink(
      user.id,
      "https://music.apple.com/us/album/iceman/1839574264",
      {
        configured: () => false,
        fetchAlbumImpl: vi.fn().mockResolvedValue(appleAlbum),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.imported).toBe(1);

    const recording = await prisma.recording.findFirstOrThrow({
      include: { externalIds: true, artists: { include: { artist: true } } },
    });
    expect(recording.externalIds[0]!.provider).toBe(Provider.apple_music);
    expect(recording.artists.map((a) => a.artist.name)).toEqual(["Drake"]);
  });

  it("prefers the catalog API when a developer token is configured", async () => {
    const user = await makeUser();
    const itunes = vi.fn().mockResolvedValue(appleAlbum);
    const catalog = vi.fn().mockResolvedValue({ ...applePlaylist, kind: "album" as const });

    await importFromAppleLink(user.id, "https://music.apple.com/us/album/iceman/1839574264", {
      configured: () => true,
      fetchAlbumImpl: itunes,
      fetchAlbumCatalogImpl: catalog,
    });

    // The catalog returns real artist relationships; iTunes flattens them, so
    // when both are available the richer one wins.
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(itunes).not.toHaveBeenCalled();
  });

  it("explains rather than failing when Apple has no such album", async () => {
    const user = await makeUser();
    const result = await importFromAppleLink(
      user.id,
      "https://music.apple.com/us/album/nothing/1111111111",
      { configured: () => false, fetchAlbumImpl: vi.fn().mockResolvedValue(null) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-found");
    expect(await prisma.collection.count()).toBe(0);
  });
});

describe("Apple playlist import", () => {
  it("links every credited artist separately", async () => {
    const user = await makeUser();

    const result = await importFromAppleLink(
      user.id,
      "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
      { configured: () => true, fetchPlaylistCatalogImpl: vi.fn().mockResolvedValue(applePlaylist) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const recording = await prisma.recording.findFirstOrThrow({
      include: { artists: { orderBy: { position: "asc" }, include: { artist: true } }, externalIds: true },
    });

    // Two entities from two ids — the fidelity the catalog API exists for.
    expect(recording.artists.map((a) => a.artist.name)).toEqual(["KAROL G", "Bruno Mars"]);
    // And the credit string is preserved verbatim, never rebuilt from them.
    expect(recording.artistDisplay).toBe("KAROL G & Bruno Mars");
    expect(recording.externalIds[0]!.isrc).toBe("USUM72500001");
  });

  /**
   * The one refusal that is about a missing account rather than a missing
   * track. It has to name the reason, because "not found" would send someone
   * looking for a problem with their playlist.
   */
  it("refuses clearly when no developer token is configured", async () => {
    const user = await makeUser();
    const fetcher = vi.fn();

    const result = await importFromAppleLink(
      user.id,
      "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
      { configured: () => false, fetchPlaylistCatalogImpl: fetcher },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("needs-developer-token");
    expect(result.message).toMatch(/CSV/);
    // And it refuses before spending a request.
    expect(fetcher).not.toHaveBeenCalled();
    expect(await prisma.collection.count()).toBe(0);
  });
});

describe("a link that is not a collection", () => {
  it("refuses an Apple track link", async () => {
    const user = await makeUser();
    const result = await importFromAppleLink(
      user.id,
      "https://music.apple.com/us/album/cn-tower/1795321820?i=1795321826",
      { configured: () => true },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-collection");
  });

  it("refuses a Spotify link", async () => {
    const user = await makeUser();
    const result = await importFromAppleLink(
      user.id,
      "https://open.spotify.com/album/6Rl6YoCarF2GHPSQmmFjuR",
      { configured: () => true },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-collection");
  });
});
