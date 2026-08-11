"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NoteNotFoundError, createNote, deleteNote, updateNote } from "@/lib/notes/service";

/**
 * Writing a note about a track **in the context of a collection**.
 *
 * This is the capability v1 actually had and v2 has been missing a surface for:
 * a note about "CN TOWER, third song into this playlist" means something
 * different from a note about the recording in the abstract, and losing that
 * context loses the point of the note.
 *
 * **The client supplies a collection item id and a body. Nothing else.** The
 * recording is looked up from the item, server-side, rather than accepted as a
 * parameter — a client that could name both could pair someone else's item with
 * an arbitrary recording, and validating the pair afterwards is a weaker
 * position than never having accepted it. The lookup is owner-scoped through the
 * collection, so an item belonging to another user simply does not resolve.
 */

export interface CollectionNoteState {
  error?: string;
  /** Echoed back so a failed submit does not discard what was typed. */
  body?: string;
}

/** Resolve an item to its recording, or null if it is not this user's. */
async function ownedItem(ownerId: string, collectionItemId: string) {
  return prisma.collectionItem.findFirst({
    where: { id: collectionItemId, collection: { ownerId } },
    select: { id: true, recordingId: true, collectionId: true },
  });
}

export async function saveCollectionNoteAction(
  collectionItemId: string,
  _previous: CollectionNoteState,
  formData: FormData,
): Promise<CollectionNoteState> {
  const user = await requireUser();
  const body = String(formData.get("body") ?? "").trim();
  const noteId = String(formData.get("noteId") ?? "").trim();

  if (!body) return { error: "Write something first.", body };

  const item = await ownedItem(user.id, collectionItemId);
  // Deliberately the same response as a malformed id: a valid id belonging to
  // someone else must not be distinguishable from one that does not exist.
  if (!item) return { error: "That track isn't in one of your collections." };

  try {
    if (noteId) {
      await updateNote(user.id, noteId, { body });
    } else {
      await createNote(user.id, {
        recordingId: item.recordingId,
        collectionItemId: item.id,
        body,
      });
    }
  } catch (error) {
    if (error instanceof NoteNotFoundError) {
      return { error: "That note is no longer there.", body };
    }
    return { error: "Something went wrong saving that note.", body };
  }

  revalidatePath(`/collections/${item.collectionId}`);
  revalidatePath("/notes");
  return {};
}

export async function deleteCollectionNoteAction(
  collectionId: string,
  noteId: string,
): Promise<void> {
  const user = await requireUser();
  try {
    await deleteNote(user.id, noteId);
  } catch (error) {
    // Gone or never theirs — the two are deliberately indistinguishable, and
    // re-rendering the list is the right answer to both.
    if (!(error instanceof NoteNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/notes");
}
