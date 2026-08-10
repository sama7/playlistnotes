"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { captureFromSpotifyLink } from "@/lib/music/capture";
import { importFromSpotifyLink } from "@/lib/music/import-from-link";
import { parseSpotifyLink } from "@/lib/music/spotify/parse-link";
import {
  NoteNotFoundError,
  createNote,
  deleteNote,
  publishNoteUnlisted,
  rotateShareToken,
  unpublishNote,
  updateNote,
} from "@/lib/notes/service";

/**
 * Server Actions for the note flow.
 *
 * Every one of these calls `requireUser()` and passes the resulting id as the
 * owner. **No action reads a user id from its form data**, and none should:
 * that is precisely how v1's endpoints ended up world-writable.
 *
 * Errors are returned as state rather than thrown, so a failed capture
 * re-renders the form with what the user typed still in it.
 */

export interface CaptureState {
  error?: string;
  /** Set after a successful collection import, so the UI can celebrate it. */
  imported?: { name: string; count: number; created: number; matched: number };
  /** Set when metadata could not be fetched and we need the user's help. */
  needsMetadata?: boolean;
  values?: { link: string; title: string; artistDisplay: string; body: string };
}

export async function captureAndCreateNote(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requireUser();

  const link = String(formData.get("link") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const artistDisplay = String(formData.get("artistDisplay") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const values = { link, title, artistDisplay, body };

  if (!link) return { error: "Paste a Spotify link to get started.", values };

  /**
   * One box, three outcomes. An album or playlist link imports a collection
   * and needs no note text; a track link writes a note. Routing on what was
   * actually pasted beats making the user pick the right form first.
   */
  const kind = parseSpotifyLink(link).kind;
  if (kind === "album" || kind === "playlist") {
    const result = await importFromSpotifyLink(user.id, link);
    if (!result.ok) return { error: result.message, values };
    revalidatePath("/notes");
    revalidatePath("/collections");
    return {
      imported: {
        name: result.summary.name,
        count: result.summary.imported,
        created: result.summary.created,
        matched: result.summary.matched,
      },
    };
  }

  if (!body) return { error: "Write something about the track.", values };

  const capture = await captureFromSpotifyLink(link, {
    fallback: title || artistDisplay ? { title, artistDisplay } : undefined,
  });

  if (!capture.ok) {
    return {
      error: capture.message,
      // Only this refusal is recoverable by the user filling in more; the
      // others are explanations, not prompts.
      needsMetadata: capture.reason === "needs-manual-metadata",
      // Hand back the title oEmbed gave us so the user fills one field, not
      // two. oEmbed never supplies an artist, so this branch is the norm on a
      // first paste rather than an error case.
      values: { ...values, title: values.title || capture.suggested?.title || "" },
    };
  }

  try {
    await createNote(user.id, { recordingId: capture.result.recording.id, body });
  } catch {
    return { error: "Something went wrong saving that note.", values };
  }

  revalidatePath("/notes");
  return {};
}

/**
 * These are bound directly to `<form action=…>`, so they must resolve to void.
 *
 * A NoteNotFoundError here means the note is gone or was never the caller's —
 * the two are deliberately indistinguishable. Swallowing it and revalidating is
 * the right response: the list re-renders without the note, and a prober learns
 * nothing from the difference.
 */
export async function updateNoteAction(noteId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  try {
    await updateNote(user.id, noteId, { body });
  } catch (error) {
    if (!(error instanceof NoteNotFoundError)) throw error;
  }

  revalidatePath("/notes");
}

export async function deleteNoteAction(noteId: string): Promise<void> {
  const user = await requireUser();
  try {
    await deleteNote(user.id, noteId);
  } catch (error) {
    if (!(error instanceof NoteNotFoundError)) throw error;
  }
  revalidatePath("/notes");
}

export async function publishNoteAction(noteId: string) {
  const user = await requireUser();
  await publishNoteUnlisted(user.id, noteId);
  revalidatePath("/notes");
}

export async function unpublishNoteAction(noteId: string) {
  const user = await requireUser();
  await unpublishNote(user.id, noteId);
  revalidatePath("/notes");
}

export async function rotateShareTokenAction(noteId: string) {
  const user = await requireUser();
  await rotateShareToken(user.id, noteId);
  revalidatePath("/notes");
}
