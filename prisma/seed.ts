/**
 * Seed data for local development.
 *
 * This is deliberately built around the cases that are hard to picture in the
 * abstract, so the schema can be judged by clicking through it in Prisma Studio
 * rather than by reading it:
 *
 *   1. A multi-artist track, linked from provider IDs — never from the
 *      comma-joined name string.
 *   2. The same recording appearing TWICE in one collection at different
 *      positions, which is why (collection_id, recording_id) is not unique.
 *   3. Two users holding private notes on the SAME shared recording, with
 *      different per-note display overrides.
 *   4. A user-authored recording (origin = user) with no external identifier.
 *   5. A note carrying playlist context via collection_item_id.
 *   6. Two immutable snapshots of one logical collection, where the older
 *      snapshot still holds the item a note points at.
 *
 * All data is synthetic. No real user content, no provider payloads, no tokens.
 */

import { PrismaClient, Provider, RecordingOrigin, Visibility } from "@prisma/client";
import { normalizedKey } from "../lib/music/normalize";

const prisma = new PrismaClient();

/** Fake but well-formed Spotify-shaped IDs (22 chars, base62). */
const spotifyId = (seed: string) => seed.padEnd(22, "0").slice(0, 22);

async function main() {
  console.log("Seeding…");

  // --- Users ---------------------------------------------------------------
  // auth_subject mimics a Clerk subject. In the real app it is only ever read
  // from a verified server session, never from client input.
  const ada = await prisma.user.create({
    data: {
      authSubject: "user_seed_ada",
      username: "ada",
      displayName: "Ada",
    },
  });

  const blue = await prisma.user.create({
    data: {
      authSubject: "user_seed_blue",
      username: "blue",
      displayName: "Blue",
    },
  });

  // --- Artists (created from provider IDs only) ----------------------------
  const makeArtist = async (name: string, id: string) =>
    prisma.artist.create({
      data: {
        name,
        sortName: name,
        externalIds: {
          create: {
            provider: Provider.spotify,
            providerId: spotifyId(id),
            providerUrl: `https://open.spotify.com/artist/${spotifyId(id)}`,
          },
        },
      },
    });

  const nova = await makeArtist("Nova Vera", "artistnova");
  const kestrel = await makeArtist("Kestrel", "artistkestrel");
  const marlow = await makeArtist("Marlow", "artistmarlow");

  // --- Album ---------------------------------------------------------------
  const album = await prisma.album.create({
    data: {
      title: "Long Way Around",
      primaryArtistId: nova.id,
      artistDisplay: "Nova Vera",
      releaseDate: new Date("2024-03-15"),
      // The raw, unsplit URI list is retained so a future album_artists join
      // table is a pure backfill rather than a reconstruction from strings.
      sourceMetadata: {
        albumArtistUris: [`spotify:artist:${spotifyId("artistnova")}`],
        retrievedAt: new Date().toISOString(),
      },
      externalIds: {
        create: {
          provider: Provider.spotify,
          providerId: spotifyId("albumlongway"),
          providerUrl: `https://open.spotify.com/album/${spotifyId("albumlongway")}`,
        },
      },
    },
  });

  // --- Case 1: a multi-artist recording ------------------------------------
  // "Nova Vera, Kestrel" would be ambiguous to split on commas. The artists are
  // linked from the two URIs instead; the raw string is kept for display.
  const duet = await prisma.recording.create({
    data: {
      title: "Signal Fade",
      artistDisplay: "Nova Vera, Kestrel",
      origin: RecordingOrigin.provider,
      normalizedKey: normalizedKey({
        title: "Signal Fade",
        artistDisplay: "Nova Vera, Kestrel",
        durationMs: 214_000,
      }),
      durationMs: 214_000,
      albumId: album.id,
      releaseTitle: album.title,
      releaseDate: album.releaseDate,
      externalIds: {
        create: {
          provider: Provider.spotify,
          providerId: spotifyId("tracksignalfade"),
          providerUrl: `https://open.spotify.com/track/${spotifyId("tracksignalfade")}`,
          isrc: "USNV12400001",
          sourceMetadata: {
            artistUris: [
              `spotify:artist:${spotifyId("artistnova")}`,
              `spotify:artist:${spotifyId("artistkestrel")}`,
            ],
          },
        },
      },
      artists: {
        create: [
          // position is the SOURCE's ordering as captured, not a billing claim.
          { artistId: nova.id, position: 0 },
          { artistId: kestrel.id, position: 1, creditName: "Kestrel (feat.)" },
        ],
      },
    },
  });

  // A single-artist recording, for contrast.
  const solo = await prisma.recording.create({
    data: {
      title: "Harbour Light",
      artistDisplay: "Marlow",
      origin: RecordingOrigin.provider,
      normalizedKey: normalizedKey({
        title: "Harbour Light",
        artistDisplay: "Marlow",
        durationMs: 187_000,
      }),
      durationMs: 187_000,
      externalIds: {
        create: {
          provider: Provider.spotify,
          providerId: spotifyId("trackharbour"),
          providerUrl: `https://open.spotify.com/track/${spotifyId("trackharbour")}`,
          isrc: "GBML12300042",
        },
      },
      artists: { create: [{ artistId: marlow.id, position: 0 }] },
    },
  });

  // --- Case 4: a user-authored recording, no external identifier -----------
  // The mp3 a friend sent. Creator-scoped: it stays out of other users'
  // resolution candidates and off any future shared page until it acquires a
  // provider identifier or is deliberately promoted.
  const cassette = await prisma.recording.create({
    data: {
      title: "Basement Take",
      artistDisplay: "The Fenwick Sisters",
      origin: RecordingOrigin.user,
      createdById: ada.id,
      normalizedKey: normalizedKey({
        title: "Basement Take",
        artistDisplay: "The Fenwick Sisters",
        durationMs: null,
      }),
    },
  });

  // --- Imports and two immutable snapshots ---------------------------------
  const firstImport = await prisma.import.create({
    data: {
      ownerId: ada.id,
      provider: Provider.spotify,
      filename: "long_drives.csv",
      contentHash: "a".repeat(64),
      status: "completed",
      rowCount: 3,
    },
  });

  // --- Case 2 + 6: snapshot one, with a duplicated recording ---------------
  const snapshotOne = await prisma.collection.create({
    data: {
      ownerId: ada.id,
      name: "Long Drives",
      description: "Imported from Exportify, March.",
      visibility: Visibility.private,
      importId: firstImport.id,
      // Provenance from a pasted playlist link. Note that the link did not
      // create this collection — the CSV did. The link only decorated it.
      sourceProvider: Provider.spotify,
      sourceId: spotifyId("playlistdrives"),
      sourceUrl: `https://open.spotify.com/playlist/${spotifyId("playlistdrives")}`,
      sourceSnapshotAt: new Date("2026-03-02T10:00:00Z"),
      items: {
        create: [
          { recordingId: duet.id, position: 0 },
          { recordingId: solo.id, position: 1 },
          // The SAME recording again, deliberately. A playlist may repeat a
          // track, which is why (collection_id, recording_id) is not unique.
          { recordingId: duet.id, position: 2 },
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });

  const secondImport = await prisma.import.create({
    data: {
      ownerId: ada.id,
      provider: Provider.spotify,
      filename: "long_drives_august.csv",
      contentHash: "b".repeat(64),
      status: "completed",
      rowCount: 2,
    },
  });

  // Snapshot two: a re-import of the same logical playlist, in a different
  // order. It is a NEW collection — the older snapshot is untouched, which is
  // what keeps the note below from being retargeted or orphaned.
  await prisma.collection.create({
    data: {
      ownerId: ada.id,
      name: "Long Drives",
      description: "Re-imported in August; order changed upstream.",
      visibility: Visibility.private,
      importId: secondImport.id,
      sourceProvider: Provider.spotify,
      sourceId: spotifyId("playlistdrives"),
      sourceUrl: `https://open.spotify.com/playlist/${spotifyId("playlistdrives")}`,
      sourceSnapshotAt: new Date("2026-08-01T10:00:00Z"),
      items: {
        create: [
          { recordingId: solo.id, position: 0 },
          { recordingId: duet.id, position: 1 },
        ],
      },
    },
  });

  // --- Case 3 + 5: two users, one shared recording, private notes ----------
  // Ada's note carries playlist context: "this track, in this collection, at
  // this position". It points at the FIRST snapshot's item and stays valid.
  const firstItem = snapshotOne.items.at(0);
  if (!firstItem) throw new Error("Seed invariant: snapshot one has no items.");

  await prisma.note.create({
    data: {
      ownerId: ada.id,
      recordingId: duet.id,
      collectionItemId: firstItem.id,
      body: "The key change at 2:41 is the whole reason this playlist exists.",
      visibility: Visibility.private,
    },
  });

  // Blue writes about the same shared recording and prefers a different
  // display. The override lives on the NOTE — it can never change what Ada
  // sees, and it never mutates the shared canonical recording row.
  await prisma.note.create({
    data: {
      ownerId: blue.id,
      recordingId: duet.id,
      body: "Heard this in the car on the way back from the coast.",
      displayTitle: "Signal Fade (Radio Edit)",
      displayArtist: "Nova Vera & Kestrel",
      visibility: Visibility.private,
    },
  });

  // A note on the user-authored recording, with a tag.
  const tag = await prisma.tag.create({
    data: { ownerId: ada.id, name: "memories" },
  });

  await prisma.note.create({
    data: {
      ownerId: ada.id,
      recordingId: cassette.id,
      body: "Recorded in Jonah's basement. Nobody else has a copy of this.",
      visibility: Visibility.private,
      tags: { create: [{ tagId: tag.id }] },
    },
  });

  // One unlisted note, to show that sharing uses a rotatable token rather than
  // the internal UUID.
  await prisma.note.create({
    data: {
      ownerId: ada.id,
      recordingId: solo.id,
      body: "Shared this one with the group chat.",
      visibility: Visibility.unlisted,
      shareToken: "seed-unlisted-token-0001",
      publishedAt: new Date(),
    },
  });

  const counts = {
    users: await prisma.user.count(),
    artists: await prisma.artist.count(),
    albums: await prisma.album.count(),
    recordings: await prisma.recording.count(),
    recordingArtists: await prisma.recordingArtist.count(),
    collections: await prisma.collection.count(),
    collectionItems: await prisma.collectionItem.count(),
    notes: await prisma.note.count(),
    imports: await prisma.import.count(),
    tags: await prisma.tag.count(),
  };

  console.table(counts);
  console.log("Seed complete. Browse it with: npm run db:studio");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
