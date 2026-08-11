import { Prisma, Provider, RecordingOrigin } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizedKey } from "@/lib/music/normalize";
import type {
  ImportableArtist,
  ImportableCollection,
  ImportableTrack,
} from "./importable";

/**
 * Turning a Spotify album or public playlist into a Playlistnotes collection.
 *
 * Two rules from AGENTS.md shape everything here:
 *
 *   - **Entities come from identifiers, never from names.** Every artist and
 *     album is resolved by its Spotify ID. The display strings are stored
 *     alongside for rendering and are never split, parsed, or matched on.
 *   - **Every import is an immutable snapshot.** Re-importing the same playlist
 *     creates a NEW collection rather than mutating the old one, so a note
 *     anchored to a collection item can never be reordered or retargeted
 *     beneath its author.
 */

export interface ImportSummary {
  collectionId: string;
  name: string;
  /** Tracks written as collection items, in source order. */
  imported: number;
  /** Recordings that already existed and were reused rather than duplicated. */
  matched: number;
  created: number;
  /** Episodes, local files and removed tracks — reported, never faked. */
  skipped: number;
  truncated: boolean;
}

/** Upsert an artist by provider ID. Never creates from a name. */
async function resolveArtist(
  tx: Prisma.TransactionClient,
  provider: Provider,
  ref: ImportableArtist,
): Promise<string> {
  const existing = await tx.artistExternalId.findUnique({
    where: { provider_providerId: { provider, providerId: ref.providerId } },
    select: { artistId: true },
  });
  if (existing) return existing.artistId;

  const artist = await tx.artist.create({
    data: {
      name: ref.name,
      sortName: ref.name,
      externalIds: {
        create: { provider, providerId: ref.providerId },
      },
    },
  });
  return artist.id;
}

async function resolveAlbum(
  tx: Prisma.TransactionClient,
  provider: Provider,
  album: NonNullable<ImportableTrack["album"]>,
): Promise<string> {
  const existing = await tx.albumExternalId.findUnique({
    where: { provider_providerId: { provider, providerId: album.providerId } },
    select: { albumId: true },
  });
  if (existing) return existing.albumId;

  const artistIds = await Promise.all(album.artists.map((a) => resolveArtist(tx, provider, a)));

  const created = await tx.album.create({
    data: {
      title: album.name,
      artistDisplay: album.artists.map((a) => a.name).join(", ") || null,
      releaseDate: parseReleaseDate(album.releaseDate),
      sourceMetadata: {
        provider,
        albumArtistIds: album.artists.map((a) => a.providerId),
        retrievedAt: new Date().toISOString(),
      },
      externalIds: {
        create: { provider, providerId: album.providerId },
      },
      artists: {
        create: artistIds.map((artistId, position) => ({ artistId, position })),
      },
    },
  });
  return created.id;
}

/** Spotify release dates come as YYYY, YYYY-MM or YYYY-MM-DD. */
function parseReleaseDate(value: string | null): Date | null {
  if (!value) return null;
  const parts = value.split("-");
  const [y, m, d] = [parts[0], parts[1] ?? "01", parts[2] ?? "01"];
  const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface ResolvedTrack {
  recordingId: string;
  wasCreated: boolean;
}

async function resolveTrack(
  tx: Prisma.TransactionClient,
  provider: Provider,
  track: ImportableTrack,
): Promise<ResolvedTrack> {
  const existing = await tx.recordingExternalId.findUnique({
    where: { provider_providerId: { provider, providerId: track.providerId } },
    select: { recordingId: true },
  });
  if (existing) return { recordingId: existing.recordingId, wasCreated: false };

  const albumId = track.album ? await resolveAlbum(tx, provider, track.album) : null;
  const artistIds = await Promise.all(
    track.artists.map((a) => resolveArtist(tx, provider, a)),
  );

  const recording = await tx.recording.create({
    data: {
      title: track.name,
      artistDisplay: track.artistDisplay,
      origin: RecordingOrigin.provider,
      normalizedKey: normalizedKey({
        title: track.name,
        artistDisplay: track.artistDisplay,
        durationMs: track.durationMs,
      }),
      durationMs: track.durationMs,
      albumId,
      releaseTitle: track.album?.name ?? null,
      releaseDate: parseReleaseDate(track.album?.releaseDate ?? null),
      externalIds: {
        create: {
          provider,
          providerId: track.providerId,
          isrc: track.isrc,
          sourceMetadata: {
            artistIds: track.artists.map((a) => a.providerId),
            trackNumber: track.trackNumber,
          },
        },
      },
      artists: {
        create: artistIds.map((artistId, position) => ({ artistId, position })),
      },
    },
  });

  return { recordingId: recording.id, wasCreated: true };
}

/**
 * Write a collection snapshot.
 *
 * The whole thing runs in one transaction: a half-written collection is worse
 * than none, since the user would have to work out what is missing.
 */
export async function importCollection(
  ownerId: string,
  data: ImportableCollection,
  options: { skippedCount?: number } = {},
): Promise<ImportSummary> {

  return prisma.$transaction(
    async (tx) => {
      const record = await tx.import.create({
        data: {
          ownerId,
          provider: data.provider,
          filename: null,
          status: "processing",
          rowCount: data.tracks.length,
        },
      });

      let matched = 0;
      let created = 0;
      const recordingIds: string[] = [];

      for (const track of data.tracks) {
        const resolved = await resolveTrack(tx, data.provider, track);
        if (resolved.wasCreated) created++;
        else matched++;
        recordingIds.push(resolved.recordingId);
      }

      const collection = await tx.collection.create({
        data: {
          ownerId,
          name: data.name,
          description: data.description,
          importId: record.id,
          sourceProvider: data.provider,
          sourceId: data.providerId,
          sourceUrl: data.sourceUrl,
          sourceSnapshotAt: new Date(),
          // Positions follow SOURCE ORDER, and duplicates are preserved — a
          // playlist may legitimately contain the same track twice.
          items: {
            create: recordingIds.map((recordingId, position) => ({ recordingId, position })),
          },
        },
      });

      await tx.import.update({
        where: { id: record.id },
        data: { status: "completed", rowCount: data.tracks.length },
      });

      return {
        collectionId: collection.id,
        name: collection.name,
        imported: recordingIds.length,
        matched,
        created,
        skipped: options.skippedCount ?? 0,
        truncated: data.truncated,
      };
    },
    { timeout: 30_000 },
  );
}
