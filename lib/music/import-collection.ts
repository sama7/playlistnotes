import { prisma } from "@/lib/db";
import { resolveImportableTrack } from "./persist-track";
import type { ImportableCollection } from "./importable";

/**
 * Turning a Spotify album or public playlist into a TrackJot collection.
 *
 * Two rules from AGENTS.md shape everything here:
 *
 *   - **Entities come from identifiers, never from names.** Every artist and
 *     album is resolved by its Spotify ID. The display strings are stored
 *     alongside for rendering and are never split, parsed, or matched on.
 *   - **A note is never deleted or silently retargeted by an import.** This
 *     used to be guaranteed by refusing to change a collection at all: every
 *     import made a new immutable snapshot. That protected notes by declining
 *     the use case — playlists change, and a living one accumulated a pile of
 *     near-identical collections with the notes scattered across them. A
 *     collection can now be refreshed in place (see lib/collections/refresh.ts),
 *     and the guarantee is upheld directly instead: notes re-anchor by
 *     (recording, occurrence), and anything that loses its slot is orphaned,
 *     never deleted. A plain import still creates a new collection.
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
          artworkUrl: data.artwork?.url ?? null,
          artworkThumbUrl: data.artwork?.thumbUrl ?? null,
          // Positions follow SOURCE ORDER, and duplicates are preserved — a
          // playlist may legitimately contain the same track twice.
          items: {
            create: recordingIds.map((recordingId, position) => ({
              recordingId,
              position,
              occurrence: occurrenceOf(recordingIds, position),
            })),
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

/**
 * Which appearance of this recording the item at `position` is, counting from 0.
 *
 * Computed at write time so a refresh can re-anchor notes by (recording,
 * occurrence) without recomputing it — and so the number is stable even if a
 * later query forgets to order by position.
 */
function occurrenceOf(recordingIds: string[], position: number): number {
  let n = 0;
  for (let i = 0; i < position; i++) {
    if (recordingIds[i] === recordingIds[position]) n++;
  }
  return n;
}
