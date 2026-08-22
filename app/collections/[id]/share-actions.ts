"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Visibility } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import {
  CollectionNotFoundError,
  deleteCollection,
  setCollectionVisibility,
  setSharedNotes,
  updateCollection,
} from "@/lib/collections/service";
import { refreshCollection, type RefreshOutcome } from "@/lib/collections/refresh";

/**
 * Owner-side controls for a collection: who can see it, what it's called, and
 * whether it exists.
 *
 * Each takes the collection id bound server-side and re-derives the acting user
 * from the session. A `CollectionNotFoundError` means the collection is gone or
 * was never the caller's; those are deliberately indistinguishable, and
 * re-rendering is the correct answer to both.
 */

export async function setCollectionVisibilityAction(
  collectionId: string,
  requested: string,
): Promise<void> {
  const user = await requireUser();
  // Parsed against the enum rather than cast: this value decides whether a
  // private collection becomes world-readable, and it arrives from the client.
  if (!Object.values(Visibility).includes(requested as Visibility)) return;

  try {
    await setCollectionVisibility(user.id, collectionId, requested as Visibility);
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/collections");
}

/** The no-JS path: a real form submit, same validation, same action. */
export async function setCollectionVisibilityFormAction(
  collectionId: string,
  formData: FormData,
): Promise<void> {
  await setCollectionVisibilityAction(collectionId, String(formData.get("visibility") ?? ""));
}

export async function renameCollectionAction(
  collectionId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "");
  if (!name) return;

  try {
    await updateCollection(user.id, collectionId, { name, description });
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/collections");
}

/**
 * Delete a collection.
 *
 * Notes written about tracks *in* this collection survive as notes about those
 * tracks — `collection_item_id` is `ON DELETE SET NULL`, so the writing outlives
 * the container. A note about the collection itself has no track to fall back
 * to and goes with it; the confirmation in the UI says so before this runs.
 */
export async function deleteCollectionAction(collectionId: string): Promise<void> {
  const user = await requireUser();
  try {
    await deleteCollection(user.id, collectionId);
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath("/collections");
  revalidatePath("/notes");
  redirect("/collections");
}

/**
 * Re-read the tracklist from the source this collection came from.
 *
 * Two calls, one code path: `apply: false` returns a preview and writes
 * nothing, `apply: true` performs it. The user confirms against the preview, so
 * the numbers they agreed to are computed by the same function that acts.
 */
export async function previewRefreshAction(collectionId: string): Promise<RefreshOutcome> {
  const user = await requireUser();
  return refreshCollection(user.id, collectionId, { apply: false });
}

export async function applyRefreshAction(collectionId: string): Promise<RefreshOutcome> {
  const user = await requireUser();
  const result = await refreshCollection(user.id, collectionId, { apply: true });
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/notes");
  return result;
}

/**
 * Choose which notes travel with a shared collection.
 *
 * The checkbox names are read as a set; anything absent is un-ticked, because
 * the form describes the desired end state rather than a diff. A partial
 * request must never leave a note shared that the owner just cleared.
 */
export async function setSharedNotesAction(
  collectionId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const noteIds = formData.getAll("noteId").map(String).filter(Boolean);

  try {
    await setSharedNotes(user.id, collectionId, noteIds);
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/notes");
}
