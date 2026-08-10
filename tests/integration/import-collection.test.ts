import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importCollection } from "@/lib/music/import-collection";
import type { SpotifyCollectionData } from "@/lib/music/spotify/web-api";
import { createNote, getNote } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

const PND = { id: "2HPaUgqeutzr3jx5a9WyDV", name: "PARTYNEXTDOOR" };
const DRAKE = { id: "3TVXtAsR1Inumwj472S9r4", name: "Drake" };
const ALBUM = {
  id: "6Rl6YoCarF2GHPSQmmFjuR",
  name: "$ome $exy $ongs 4 U",
  artists: [PND, DRAKE],
  releaseDate: "2025-02-14",
};

const track = (id: string, name: string, artists = [PND, DRAKE], durationMs = 240_000) => ({
  id,
  name,
  artists,
  artistDisplay: artists.map((a) => a.name).join(", "),
  durationMs,
  isrc: null,
  trackNumber: 1,
  album: ALBUM,
});

const albumData: SpotifyCollectionData = {
  id: ALBUM.id,
  kind: "album",
  name: ALBUM.name,
  description: null,
  artists: [PND, DRAKE],
  ownerName: null,
  releaseDate: "2025-02-14",
  tracks: [
    track("4u43I0LP2Xf85OAS85eG0R", "CN TOWER"),
    track("aaaaaaaaaaaaaaaaaaaaaa", "MOTH BALLS"),
    track("bbbbbbbbbbbbbbbbbbbbbb", "CRYING IN CHANEL", [DRAKE]),
  ],
  truncated: false,
};

async function owner() {
  return prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("importing an album", () => {
  it("creates an ordered collection with every entity linked from IDs", async () => {
    const user = await owner();
    const summary = await importCollection(user.id, albumData);

    expect(summary.imported).toBe(3);
    expect(summary.created).toBe(3);
    expect(summary.matched).toBe(0);

    const items = await prisma.collectionItem.findMany({
      where: { collectionId: summary.collectionId },
      orderBy: { position: "asc" },
      include: { recording: { include: { artists: { include: { artist: true } } } } },
    });

    expect(items.map((i) => i.recording.title)).toEqual([
      "CN TOWER",
      "MOTH BALLS",
      "CRYING IN CHANEL",
    ]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);

    // Two artists on the first track, one on the third — from IDs, not strings.
    expect(items[0]?.recording.artists).toHaveLength(2);
    expect(items[2]?.recording.artists).toHaveLength(1);
    expect(await prisma.artist.count()).toBe(2);
  });

  it("links the album and its artists", async () => {
    const user = await owner();
    await importCollection(user.id, albumData);

    const album = await prisma.album.findFirstOrThrow({
      include: { artists: { orderBy: { position: "asc" }, include: { artist: true } } },
    });

    expect(album.title).toBe("$ome $exy $ongs 4 U");
    expect(album.artists.map((a) => a.artist.name)).toEqual(["PARTYNEXTDOOR", "Drake"]);
    expect(await prisma.album.count()).toBe(1);
  });

  it("reuses recordings a second import already created", async () => {
    const a = await owner();
    const b = await owner();

    await importCollection(a.id, albumData);
    const second = await importCollection(b.id, albumData);

    expect(second.matched).toBe(3);
    expect(second.created).toBe(0);
    // Three recordings total, not six. Two collections, two imports.
    expect(await prisma.recording.count()).toBe(3);
    expect(await prisma.collection.count()).toBe(2);
    expect(await prisma.artist.count()).toBe(2);
  });
});

describe("importing a playlist", () => {
  const playlistData: SpotifyCollectionData = {
    id: "3n6CBlx7hupg3c8UZ0xlSW",
    kind: "playlist",
    name: "aug23",
    description: "late night",
    artists: [],
    ownerName: "samah",
    releaseDate: null,
    tracks: [
      track("cccccccccccccccccccccc", "Dedicada a ela", [{ id: "artverocai00000000000", name: "Arthur Verocai" }]),
      track("4u43I0LP2Xf85OAS85eG0R", "CN TOWER"),
      // The same track again — playlists legitimately repeat.
      track("4u43I0LP2Xf85OAS85eG0R", "CN TOWER"),
    ],
    truncated: false,
  };

  it("preserves source order and duplicate tracks", async () => {
    const user = await owner();
    const summary = await importCollection(user.id, playlistData);

    const items = await prisma.collectionItem.findMany({
      where: { collectionId: summary.collectionId },
      orderBy: { position: "asc" },
      include: { recording: true },
    });

    expect(items).toHaveLength(3);
    expect(items[1]?.recording.id).toBe(items[2]?.recording.id);
    // One recording backing two items — that is why (collection_id,
    // recording_id) is deliberately not unique.
    expect(await prisma.recording.count()).toBe(2);
  });

  it("records the playlist as provenance rather than claiming a sync", async () => {
    const user = await owner();
    const summary = await importCollection(user.id, playlistData);

    const collection = await prisma.collection.findUniqueOrThrow({
      where: { id: summary.collectionId },
    });

    expect(collection.sourceUrl).toBe("https://open.spotify.com/playlist/3n6CBlx7hupg3c8UZ0xlSW");
    expect(collection.sourceSnapshotAt).toBeTruthy();
    expect(collection.importId).toBeTruthy();
  });
});

describe("re-import is a new snapshot, never a mutation", () => {
  /**
   * The guarantee that makes playlist import safe: a note anchored to a
   * collection item must never be reordered or retargeted beneath its author.
   */
  it("leaves an existing note and its item exactly where they were", async () => {
    const user = await owner();
    const first = await importCollection(user.id, albumData);

    const items = await prisma.collectionItem.findMany({
      where: { collectionId: first.collectionId },
      orderBy: { position: "asc" },
    });
    const anchoredItem = items[0]!;

    const note = await createNote(user.id, {
      recordingId: anchoredItem.recordingId,
      body: "the opening track sets the tone",
      collectionItemId: anchoredItem.id,
    });

    // The playlist changed upstream: reordered, one track removed.
    const reordered: SpotifyCollectionData = {
      ...albumData,
      tracks: [albumData.tracks[2]!, albumData.tracks[0]!],
    };
    const second = await importCollection(user.id, reordered);

    expect(second.collectionId).not.toBe(first.collectionId);

    const after = await getNote(user.id, note.id);
    expect(after?.collectionItemId).toBe(anchoredItem.id);

    const stillThere = await prisma.collectionItem.findUniqueOrThrow({
      where: { id: anchoredItem.id },
    });
    expect(stillThere.position).toBe(0);
    expect(stillThere.collectionId).toBe(first.collectionId);
  });

  it("keeps both snapshots readable", async () => {
    const user = await owner();
    await importCollection(user.id, albumData);
    await importCollection(user.id, albumData);

    expect(await prisma.collection.count()).toBe(2);
    expect(await prisma.import.count()).toBe(2);
    expect(await prisma.recording.count()).toBe(3);
  });
});
