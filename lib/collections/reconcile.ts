import { Prisma } from "@prisma/client";

/**
 * Replacing a collection's tracklist without losing the writing on it.
 *
 * ## Why this exists at all
 *
 * The original rule was that a collection is an **immutable snapshot** and a
 * re-import creates a new one. That protected notes absolutely — nothing could
 * move under them because nothing ever moved. It also meant a living playlist,
 * which is what most playlists are, accumulated a pile of near-identical
 * collections and the notes scattered across them. Samah asked for a refresh,
 * and he is right: the snapshot rule solved the safety problem by refusing the
 * use case.
 *
 * So the rule is reversed **with its guarantee kept explicit**: a refresh may
 * reorder, add and remove items, and it may never delete a note or silently
 * attach one to a different song.
 *
 * ## What a note is anchored to
 *
 * Not position — a track that moves from 3 to 7 is the same track. Not the
 * recording alone either, because a playlist can hold the same song three times
 * and "the second one" is a real distinction a listener makes.
 *
 * The anchor is therefore **(recording, occurrence)**: the nth appearance of
 * that recording, counting in position order. A note on the first CN TOWER
 * follows the first CN TOWER; a note on the second follows the second. If the
 * refreshed list has fewer copies than there were notes, the surplus notes are
 * **orphaned, never deleted** — they keep their body, their tags and their
 * recording, and simply stop claiming to be about a playlist slot that no longer
 * exists.
 *
 * ## Why the plan runs before the write
 *
 * `planReconciliation` is pure and takes no database handle, so the UI can show
 * exactly which notes are about to be orphaned *before* anything happens. A
 * destructive operation the user cannot preview is one they will only understand
 * after it is too late.
 */

export type ReconcileMode = "replace" | "append";

/** One track in the desired end state, in order. Duplicates are expected. */
export interface DesiredItem {
  recordingId: string;
  sourceMetadata?: Prisma.InputJsonValue;
}

/** A note anchored to an item. `updatedAt` travels so it can be preserved. */
export interface AnchoredNote {
  id: string;
  updatedAt: Date;
}

/** An item as it exists now, with the note anchors that depend on it. */
export interface ExistingItem {
  id: string;
  recordingId: string;
  position: number;
  notes: AnchoredNote[];
}

export interface PlannedItem {
  recordingId: string;
  position: number;
  occurrence: number;
  sourceMetadata?: Prisma.InputJsonValue;
  /** Notes that were anchored to this (recording, occurrence) and follow it. */
  notes: AnchoredNote[];
}

export interface ReconciliationPlan {
  items: PlannedItem[];
  /** Notes whose slot no longer exists. Kept, un-anchored, never deleted. */
  orphanedNoteIds: string[];
  added: number;
  removed: number;
  /** Same track, different position. Notes follow; nothing is lost. */
  moved: number;
  unchanged: number;
}

function key(recordingId: string, occurrence: number): string {
  return `${recordingId}#${occurrence}`;
}

/** Number each item by which appearance of its recording it is. */
function withOccurrences<T extends { recordingId: string }>(
  items: T[],
): Array<T & { occurrence: number }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = seen.get(item.recordingId) ?? 0;
    seen.set(item.recordingId, n + 1);
    return { ...item, occurrence: n };
  });
}

/**
 * Work out the end state and what it costs, without touching anything.
 *
 * `existing` must already be in position order — occurrence numbering depends
 * on it, and a caller that sorts differently would silently re-anchor notes to
 * the wrong copy of a repeated track.
 */
export function planReconciliation(
  existing: ExistingItem[],
  desired: DesiredItem[],
  mode: ReconcileMode,
): ReconciliationPlan {
  const current = withOccurrences(existing);

  // Append keeps every existing row exactly where it is and adds the new list
  // after it, so occurrence numbering continues rather than restarting.
  const combined: DesiredItem[] =
    mode === "append"
      ? [...current.map((i) => ({ recordingId: i.recordingId })), ...desired]
      : desired;

  const planned = withOccurrences(combined);

  const anchors = new Map<string, { notes: AnchoredNote[]; position: number }>();
  for (const item of current) {
    anchors.set(key(item.recordingId, item.occurrence), {
      notes: item.notes,
      position: item.position,
    });
  }

  const claimed = new Set<string>();
  let moved = 0;
  let unchanged = 0;

  const items: PlannedItem[] = planned.map((item, index) => {
    const k = key(item.recordingId, item.occurrence);
    const anchor = anchors.get(k);
    if (anchor) {
      claimed.add(k);
      if (anchor.position === index) unchanged += 1;
      else moved += 1;
    }
    return {
      recordingId: item.recordingId,
      position: index,
      occurrence: item.occurrence,
      sourceMetadata: item.sourceMetadata,
      notes: anchor?.notes ?? [],
    };
  });

  const orphanedNoteIds: string[] = [];
  for (const [k, anchor] of anchors) {
    if (!claimed.has(k)) orphanedNoteIds.push(...anchor.notes.map((n) => n.id));
  }

  return {
    items,
    orphanedNoteIds,
    added: items.length - claimed.size,
    removed: current.length - claimed.size,
    moved,
    unchanged,
  };
}

/**
 * Apply a plan inside a transaction.
 *
 * Order matters. Items are deleted first, which sets every dependent note's
 * `collection_item_id` to NULL through the FK — that is the safety net, not the
 * mechanism. The new rows are then created and the notes are re-pointed from
 * the plan computed *before* the delete, so the mapping is never read from a
 * table that is mid-rewrite.
 */
export async function applyReconciliation(
  tx: Prisma.TransactionClient,
  collectionId: string,
  plan: ReconciliationPlan,
): Promise<void> {
  await tx.collectionItem.deleteMany({ where: { collectionId } });

  for (const item of plan.items) {
    const created = await tx.collectionItem.create({
      data: {
        collectionId,
        recordingId: item.recordingId,
        position: item.position,
        occurrence: item.occurrence,
        ...(item.sourceMetadata !== undefined ? { sourceMetadata: item.sourceMetadata } : {}),
      },
      select: { id: true },
    });

    /**
     * One update per note rather than an `updateMany`, so each note keeps its
     * own `updatedAt`. Re-anchoring is not an edit — the same reasoning that
     * keeps a visibility change from moving that date. A refresh must not make
     * every note in a fifty-track playlist claim it was rewritten today.
     */
    for (const note of item.notes) {
      await tx.note.update({
        where: { id: note.id },
        data: { collectionItemId: created.id, updatedAt: note.updatedAt },
      });
    }
  }
}
