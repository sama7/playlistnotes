"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  CollectionNotFoundError,
  publishCollectionUnlisted,
  rotateCollectionShareToken,
  unpublishCollection,
} from "@/lib/collections/service";

/**
 * Owner-side share controls for a collection.
 *
 * Each takes the collection id bound server-side and re-derives the acting user
 * from the session. A `CollectionNotFoundError` means the collection is gone or
 * was never the caller's; those are deliberately indistinguishable, and
 * re-rendering is the correct answer to both.
 */

export async function publishCollectionAction(collectionId: string): Promise<void> {
  const user = await requireUser();
  try {
    await publishCollectionUnlisted(user.id, collectionId);
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/collections");
}

export async function unpublishCollectionAction(collectionId: string): Promise<void> {
  const user = await requireUser();
  try {
    await unpublishCollection(user.id, collectionId);
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/collections");
}

export async function rotateCollectionTokenAction(collectionId: string): Promise<void> {
  const user = await requireUser();
  try {
    await rotateCollectionShareToken(user.id, collectionId);
  } catch (error) {
    if (!(error instanceof CollectionNotFoundError)) throw error;
  }
  revalidatePath(`/collections/${collectionId}`);
}
