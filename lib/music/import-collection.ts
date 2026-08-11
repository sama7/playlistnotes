import { prisma } from "@/lib/db";
import { resolveImportableTrack } from "./persist-track";
import type { ImportableCollection } from "./importable";

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

/**
 * Write a collection snapshot.
 *
 * The whole thing runs in one transaction: a half-written collection is worse
 * than none, since the user would have to work out what is missing.
 */
export async function importCollection(
  ownerId: string,
  data: ImportableCollection,
  options: {
    skippedCount?: number;
    /** Recorded on the import for provenance when the source was a file. */
    filename?: string | null;
    /** SHA-256 of the original bytes, so a repeat upload can be recognised. */
    contentHash?: string | null;
  } = {},
): Promise<ImportSummary> {

  return prisma.$transaction(
    async (tx) => {
      const record = await tx.import.create({
        data: {
          ownerId,
          provider: data.provider,
          filename: options.filename ?? null,
          contentHash: options.contentHash ?? null,
          status: "processing",
          rowCount: data.tracks.length,
        },
      });

      let matched = 0;
      let created = 0;
      const recordingIds: string[] = [];

      for (const track of data.tracks) {
        const resolved = await resolveImportableTrack(tx, data.provider, track);
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
          // Empty for a CSV, which is not addressable — only its tracks are.
          sourceId: data.providerId || null,
          sourceUrl: data.sourceUrl || null,
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
