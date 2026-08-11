"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { NoteNotFoundError } from "@/lib/notes/service";
import { parseTagInput, setNoteTags } from "@/lib/notes/tags";

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
