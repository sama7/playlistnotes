/**
 * Seed data for local development.
 *
 * The MUSIC METADATA IS REAL — titles, artist names, album names, durations,
 * ISRCs, Spotify IDs and MusicBrainz IDs were looked up from MusicBrainz (open
 * data) and every Spotify ID was verified against the unauthenticated oEmbed
 * endpoint on 2026-08-08. Factual metadata, seeded so the model is exercised
 * against the shapes real catalogs actually produce.
 *
 * The USERS AND NOTES ARE SYNTHETIC. No real person's account or writing is
 * seeded, and none should ever be.
 *
 * Built around the cases that are hard to picture in the abstract:
 *
 *   1. Real multi-artist credits, linked from URIs — including "Tyler, The
 *      Creator", whose name contains a comma that is NOT a separator, next to
 *      "PARTYNEXTDOOR & Drake", which has two artists and no comma at all.
 *      No string-splitting rule survives both.
 *   2. The same recording TWICE in one collection.
 *   3. Two users holding private notes on one shared recording, disagreeing
 *      about billing order — a real disagreement for this album.
 *   4. A user-authored recording (origin = user) with no external identifier.
 *   5. A note carrying playlist context.
 *   6. Two immutable snapshots of one collection.
 */

import { PrismaClient, Provider, RecordingOrigin, Visibility } from "@prisma/client";
import { normalizedKey } from "../lib/music/normalize";

const prisma = new PrismaClient();

const spotifyTrack = (id: string) => `https://open.spotify.com/track/${id}`;
const spotifyArtist = (id: string) => `https://open.spotify.com/artist/${id}`;
const spotifyAlbum = (id: string) => `https://open.spotify.com/album/${id}`;

async function main() {
  console.log("Seeding…");

  // --- Users (synthetic) ---------------------------------------------------
  const ada = await prisma.user.create({
    data: { authSubject: "user_seed_ada", username: "ada", displayName: "Ada" },
  });
  const blue = await prisma.user.create({
    data: { authSubject: "user_seed_blue", username: "blue", displayName: "Blue" },
  });

  // --- Artists -------------------------------------------------------------
  // Created from provider IDs only. Note that "Tyler, The Creator" is a single
  // artist whose NAME contains a comma: any rule that split the display string
  // on commas would invent two artists, "Tyler" and "The Creator".
  const makeArtist = (name: string, spotifyId: string, mbid: string) =>
    prisma.artist.create({
      data: {
        name,
        sortName: name,
        externalIds: {
          create: [
            {
              provider: Provider.spotify,
              providerId: spotifyId,
              providerUrl: spotifyArtist(spotifyId),
            },
            { provider: Provider.musicbrainz, providerId: mbid },
          ],
        },
      },
    });

  const drake = await makeArtist(
    "Drake",
    "3TVXtAsR1Inumwj472S9r4",
    "9fff2f8a-21e6-47de-a2b8-7f449929d43f",
  );
  const partynextdoor = await makeArtist(
    "PARTYNEXTDOOR",
    "2HPaUgqeutzr3jx5a9WyDV",
    "f23ef341-33bd-47c1-b83c-846a78581f05",
  );
  const tyler = await makeArtist(
    "Tyler, The Creator",
    "4V8LLVI7PbaPR0K2TGSxFF",
    "f6beac20-5dfe-4d1f-ae02-0b0a740aafd6",
  );

  // --- Albums --------------------------------------------------------------
  // $ome $exy $ongs 4 U is a JOINT album: MusicBrainz credits it to
  // "PARTYNEXTDOOR & Drake". There is no album_artists join table, so
  // primary_artist_id holds the first credit and the full URI list is retained
  // in source_metadata — which is what makes that deferral a pure backfill.
  const sssfu = await prisma.album.create({
    data: {
      title: "$ome $exy $ongs 4 U",
      primaryArtistId: partynextdoor.id,
      artistDisplay: "PARTYNEXTDOOR & Drake",
      releaseDate: new Date("2025-02-14"),
      sourceMetadata: {
        albumArtistUris: [
          "spotify:artist:2HPaUgqeutzr3jx5a9WyDV",
          "spotify:artist:3TVXtAsR1Inumwj472S9r4",
        ],
        musicbrainzReleaseId: "875c2c65-faeb-402c-9478-b1fdd77155bd",
        retrievedAt: "2026-08-08T00:00:00.000Z",
      },
      externalIds: {
        create: {
          provider: Provider.spotify,
          providerId: "6Rl6YoCarF2GHPSQmmFjuR",
          providerUrl: spotifyAlbum("6Rl6YoCarF2GHPSQmmFjuR"),
        },
      },
    },
  });

  const iceman = await prisma.album.create({
    data: {
      title: "ICEMAN",
      primaryArtistId: drake.id,
      artistDisplay: "Drake",
      releaseDate: new Date("2026-05-15"),
      sourceMetadata: {
        albumArtistUris: ["spotify:artist:3TVXtAsR1Inumwj472S9r4"],
        musicbrainzReleaseId: "dceb056a-32ed-4ce3-9003-2f5e07b42cf8",
        retrievedAt: "2026-08-08T00:00:00.000Z",
      },
      externalIds: {
        create: {
          provider: Provider.spotify,
          providerId: "0OAv7DCME2AV4q1KPO95HY",
          providerUrl: spotifyAlbum("0OAv7DCME2AV4q1KPO95HY"),
        },
      },
    },
  });

  const chromakopia = await prisma.album.create({
    data: {
      title: "CHROMAKOPIA",
      primaryArtistId: tyler.id,
      artistDisplay: "Tyler, The Creator",
      releaseDate: new Date("2024-10-28"),
      sourceMetadata: {
        albumArtistUris: ["spotify:artist:4V8LLVI7PbaPR0K2TGSxFF"],
        musicbrainzReleaseId: "e41ee68e-eb4a-4ea6-9dbd-e9d0b9d72712",
        retrievedAt: "2026-08-08T00:00:00.000Z",
      },
      externalIds: {
        create: {
          provider: Provider.spotify,
          providerId: "0U28P0QVB1QRxpqp5IHOlH",
          providerUrl: spotifyAlbum("0U28P0QVB1QRxpqp5IHOlH"),
        },
      },
    },
  });

  // --- Recording 1: two artists, no comma ----------------------------------
  const cnTower = await prisma.recording.create({
    data: {
      title: "CN TOWER",
      artistDisplay: "PARTYNEXTDOOR & Drake",
      origin: RecordingOrigin.provider,
      normalizedKey: normalizedKey({
        title: "CN TOWER",
        artistDisplay: "PARTYNEXTDOOR & Drake",
        durationMs: 241_890,
      }),
      durationMs: 241_890,
      albumId: sssfu.id,
      releaseTitle: "$ome $exy $ongs 4 U",
      releaseDate: new Date("2025-02-14"),
      externalIds: {
        create: [
          {
            provider: Provider.spotify,
            providerId: "4u43I0LP2Xf85OAS85eG0R",
            providerUrl: spotifyTrack("4u43I0LP2Xf85OAS85eG0R"),
            isrc: "USLD91772040",
            sourceMetadata: {
              artistUris: [
                "spotify:artist:2HPaUgqeutzr3jx5a9WyDV",
                "spotify:artist:3TVXtAsR1Inumwj472S9r4",
              ],
              oembedTitle: "CN TOWER",
            },
          },
          {
            provider: Provider.musicbrainz,
            providerId: "3abd09a5-b5ce-4cc5-bb07-3aa586bba116",
            musicbrainzRecordingId: "3abd09a5-b5ce-4cc5-bb07-3aa586bba116",
            isrc: "USLD91772040",
          },
        ],
      },
      artists: {
        create: [
          // position is the SOURCE's ordering as captured. MusicBrainz credits
          // this album "PARTYNEXTDOOR & Drake"; plenty of people say it the
          // other way round. That disagreement is why this is a per-pair row
          // and not a canonical billing claim — see Blue's note below.
          { artistId: partynextdoor.id, position: 0 },
          { artistId: drake.id, position: 1 },
        ],
      },
    },
  });

  // --- Recording 2: single artist ------------------------------------------
  const whisperMyName = await prisma.recording.create({
    data: {
      title: "Whisper My Name",
      artistDisplay: "Drake",
      origin: RecordingOrigin.provider,
      normalizedKey: normalizedKey({
        title: "Whisper My Name",
        artistDisplay: "Drake",
        durationMs: 222_580,
      }),
      durationMs: 222_580,
      albumId: iceman.id,
      releaseTitle: "ICEMAN",
      releaseDate: new Date("2026-05-15"),
      externalIds: {
        create: [
          {
            provider: Provider.spotify,
            providerId: "7KGHenqXZofXNm5MKDbT3J",
            providerUrl: spotifyTrack("7KGHenqXZofXNm5MKDbT3J"),
            isrc: "USUG12602489",
            sourceMetadata: {
              artistUris: ["spotify:artist:3TVXtAsR1Inumwj472S9r4"],
              oembedTitle: "Whisper My Name",
            },
          },
          {
            provider: Provider.musicbrainz,
            providerId: "68b96771-386c-4e9a-99fb-9d1dfa6515ac",
            musicbrainzRecordingId: "68b96771-386c-4e9a-99fb-9d1dfa6515ac",
            isrc: "USUG12602489",
          },
        ],
      },
      artists: { create: [{ artistId: drake.id, position: 0 }] },
    },
  });

  // --- Recording 3: a comma inside the artist name AND the title -----------
  // artist_display is "Tyler, The Creator" and the title is "Darling, I".
  // Splitting either on commas produces nonsense. The single Artist URI is
  // what makes the linkage unambiguous.
  //
  // Spotify's oEmbed returns the title as "Darling, I (feat. Teezo Touchdown)"
  // with NO separate artist field — which is exactly why artist_display exists
  // and why the note form keeps title and artist editable.
  const darlingI = await prisma.recording.create({
    data: {
      title: "Darling, I",
      artistDisplay: "Tyler, The Creator",
      origin: RecordingOrigin.provider,
      normalizedKey: normalizedKey({
        title: "Darling, I",
        artistDisplay: "Tyler, The Creator",
        durationMs: 253_000,
      }),
      durationMs: 253_000,
      albumId: chromakopia.id,
      releaseTitle: "CHROMAKOPIA",
      releaseDate: new Date("2024-10-28"),
      externalIds: {
        create: [
          {
            provider: Provider.spotify,
            providerId: "0VaeksJaXy5R1nvcTMh3Xk",
            providerUrl: spotifyTrack("0VaeksJaXy5R1nvcTMh3Xk"),
            isrc: "USQX92405786",
            sourceMetadata: {
              artistUris: ["spotify:artist:4V8LLVI7PbaPR0K2TGSxFF"],
              oembedTitle: "Darling, I (feat. Teezo Touchdown)",
            },
          },
          {
            provider: Provider.musicbrainz,
            providerId: "9fa1f5cf-b5d7-409f-ac22-6c2bc3662a41",
            musicbrainzRecordingId: "9fa1f5cf-b5d7-409f-ac22-6c2bc3662a41",
            isrc: "USQX92405786",
          },
        ],
      },
      artists: { create: [{ artistId: tyler.id, position: 0 }] },
    },
  });

  // --- Recording 4: user-authored, no identifier ---------------------------
  // A phone recording of a show. Drake exists as an artist entity, but this
  // recording carries no provider ID, so it gets NO artist linkage — entities
  // are only ever created or linked from identifiers, never from a name we
  // happen to recognize. Creator-scoped and out of global resolution.
  const bootleg = await prisma.recording.create({
    data: {
      title: "Marvins Room — live, Ottawa (phone recording)",
      artistDisplay: "Drake",
      origin: RecordingOrigin.user,
      createdById: ada.id,
      normalizedKey: normalizedKey({
        title: "Marvins Room — live, Ottawa (phone recording)",
        artistDisplay: "Drake",
        durationMs: null,
      }),
    },
  });

  // --- Imports and two immutable snapshots ---------------------------------
  const februaryImport = await prisma.import.create({
    data: {
      ownerId: ada.id,
      provider: Provider.spotify,
      filename: "late_night_drives.csv",
      contentHash: "a".repeat(64),
      status: "completed",
      rowCount: 3,
    },
  });

  const snapshotOne = await prisma.collection.create({
    data: {
      ownerId: ada.id,
      name: "Late night drives",
      description: "Exportify dump, February.",
      visibility: Visibility.private,
      importId: februaryImport.id,
      sourceProvider: Provider.spotify,
      sourceUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
      sourceSnapshotAt: new Date("2026-02-11T21:00:00Z"),
      items: {
        create: [
          { recordingId: cnTower.id, position: 0 },
          { recordingId: darlingI.id, position: 1 },
          // The same recording again, deliberately.
          { recordingId: cnTower.id, position: 2 },
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });

  const augustImport = await prisma.import.create({
    data: {
      ownerId: ada.id,
      provider: Provider.spotify,
      filename: "late_night_drives_aug.csv",
      contentHash: "b".repeat(64),
      status: "completed",
      rowCount: 3,
    },
  });

  // A re-import of the same playlist after it changed upstream. A NEW snapshot,
  // so the February rows never move and Ada's note keeps pointing where she
  // left it.
  await prisma.collection.create({
    data: {
      ownerId: ada.id,
      name: "Late night drives",
      description: "Re-imported in August; order changed and a track was added.",
      visibility: Visibility.private,
      importId: augustImport.id,
      sourceProvider: Provider.spotify,
      sourceUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
      sourceSnapshotAt: new Date("2026-08-03T18:30:00Z"),
      items: {
        create: [
          { recordingId: darlingI.id, position: 0 },
          { recordingId: whisperMyName.id, position: 1 },
          { recordingId: cnTower.id, position: 2 },
        ],
      },
    },
  });

  // --- Notes ---------------------------------------------------------------
  const firstItem = snapshotOne.items.at(0);
  if (!firstItem) throw new Error("Seed invariant: February snapshot has no items.");

  await prisma.note.create({
    data: {
      ownerId: ada.id,
      recordingId: cnTower.id,
      collectionItemId: firstItem.id,
      body: "Opening track, and it sets the whole tone — the city sounds under the intro are why this playlist starts here and not anywhere else.",
      visibility: Visibility.private,
    },
  });

  // Blue writes about the same shared recording and bills the artists the other
  // way round. Both orderings are defensible; the override lives on the note,
  // so neither user rewrites the shared row or each other's view.
  await prisma.note.create({
    data: {
      ownerId: blue.id,
      recordingId: cnTower.id,
      body: "Heard this on the drive back from the airport. Always think of it as a Drake song first, whatever the credits say.",
      displayArtist: "Drake & PARTYNEXTDOOR",
      visibility: Visibility.private,
    },
  });

  const tag = await prisma.tag.create({
    data: { ownerId: ada.id, name: "live" },
  });

  await prisma.note.create({
    data: {
      ownerId: ada.id,
      recordingId: bootleg.id,
      body: "Recorded this on my phone from the floor. Terrible audio, but you can hear the whole crowd carrying the second verse.",
      visibility: Visibility.private,
      tags: { create: [{ tagId: tag.id }] },
    },
  });

  await prisma.note.create({
    data: {
      ownerId: ada.id,
      recordingId: darlingI.id,
      body: "Sent this one to the group chat after the third listen. The outro is the best two minutes on the record.",
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
    externalIds: await prisma.recordingExternalId.count(),
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
