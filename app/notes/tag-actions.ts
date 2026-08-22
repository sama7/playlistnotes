"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { NoteNotFoundError } from "@/lib/notes/service";
import { deleteTag, parseTagInput, renameTag, setNoteTags } from "@/lib/notes/tags";

/**
 * Set a note's tags from a single comma-separated field.
 *
 * Bound to `<form action=…>`, so it resolves to void. A NoteNotFoundError means
 * the note is gone or was never the caller's — indistinguishable by design, and
 * re-rendering is the right answer to both.
 */
export async function setNoteTagsAction(noteId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = String(formData.get("tags") ?? "");

  try {
    await setNoteTags(user.id, noteId, parseTagInput(raw));
  } catch (error) {
    if (!(error instanceof NoteNotFoundError)) throw error;
  }

  revalidatePath("/notes");
}

/**
 * Rename a tag everywhere, from the tag list.
 *
 * Redirecting matters here: the current page may be filtered by the old name,
 * and re-rendering it would show "Nothing tagged 'demos'" straight after a
 * successful rename — which reads as data loss. Landing on the new name shows
 * the same notes under the label the user just chose.
 */
export async function renameTagAction(oldName: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const wanted = String(formData.get("name") ?? "");

  const renamed = await renameTag(user.id, oldName, wanted);
  revalidatePath("/notes");
  if (renamed) redirect(`/notes?tag=${encodeURIComponent(renamed)}`);
}

export async function deleteTagAction(name: string): Promise<void> {
  const user = await requireUser();
  await deleteTag(user.id, name);
  revalidatePath("/notes");
  // The filter that was applied no longer exists; go back to everything.
  redirect("/notes");
}
