"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { toDateInputValue } from "@/lib/format-date";
import { DatePrecision, PlacePrecision, Visibility } from "@prisma/client";
import {
  NoteNotFoundError,
  deleteNote,
  setNoteVisibility,
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
    await updateNote(user.id, noteId, { body, ...readJournalFields(formData) });
  } catch (error) {
    if (!(error instanceof NoteNotFoundError)) throw error;
  }

  revalidatePath("/notes");
  revalidatePath("/collections");
}

/**
 * Read the optional "when" and "where" a note can carry.
 *
 * Two details do real work here. The date arrives as `YYYY-MM-DD` from a date
 * input and is **anchored to the first instant of the stated range** — a note
 * marked "that year" is stored as January 1st — because the precision, not the
 * timestamp, is what the product promises to render.
 */
function readJournalFields(formData: FormData) {
  const rawDate = String(formData.get("experiencedAt") ?? "").trim();
  const rawPrecision = String(formData.get("experiencedPrecision") ?? "day");
  const precision: DatePrecision =
    rawPrecision === "year" || rawPrecision === "month" ? rawPrecision : DatePrecision.day;

  /**
   * A note imported from a scrobble knows the minute it was heard, and the date
   * input can only express a day. If the day has not been edited, the stored
   * instant is put back untouched — otherwise merely opening the editor and
   * saving would round a known time down to a date, discarding precision the
   * writer never chose to give up.
   */
  const originalIso = String(formData.get("experiencedAtOriginal") ?? "").trim();
  if (originalIso && String(formData.get("experiencedPrecisionOriginal") ?? "") === "time") {
    const original = new Date(originalIso);
    if (!Number.isNaN(original.getTime()) && toDateInputValue(original) === rawDate) {
      return {
        experiencedAt: original,
        experiencedPrecision: DatePrecision.time,
        ...readPlaceFields(formData),
      };
    }
  }

  let experiencedAt: Date | null = null;
  if (rawDate) {
    const [y, m, d] = rawDate.split("-").map(Number);
    const month = precision === "year" ? 1 : (m ?? 1);
    const day = precision === "day" ? (d ?? 1) : 1;
    // Noon UTC, not midnight: it renders as the intended day in every time zone
    // this product is likely to display, rather than slipping backwards a day
    // west of Greenwich.
    experiencedAt = new Date(Date.UTC(y ?? 1970, month - 1, day, 12));
  }

  return {
    experiencedAt,
    experiencedPrecision: experiencedAt ? precision : null,
    ...readPlaceFields(formData),
  };
}

/** `placePrecision` is a checkbox, so its absence means `area`: opting out of
 *  precision has to be what happens when nobody does anything. */
function readPlaceFields(formData: FormData) {
  const placeLabel = String(formData.get("placeLabel") ?? "").trim() || null;
  const exact = formData.get("placePrecision") === "exact";
  return {
    placeLabel,
    placePrecision: placeLabel ? (exact ? PlacePrecision.exact : PlacePrecision.area) : null,
  };
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

/**
 * One control for who can read a note.
 *
 * It takes the value **as an argument, not as FormData**, and that is a fix for
 * a real bug rather than a style preference. The picker is a controlled select
 * that submitted its own form on change; React restores a controlled input's
 * DOM value during the change event, and the form's FormData was serialised
 * after that restore — so every change after the first submitted the *previous*
 * value and silently did nothing. Passing the chosen value directly removes the
 * DOM from the path entirely.
 *
 * The value is still parsed against the enum here. It arrives from the client,
 * and it decides whether a private note becomes world-readable; an unrecognised
 * value is ignored rather than defaulted, since the safe response is "change
 * nothing".
 */
export async function setNoteVisibilityAction(
  noteId: string,
  requested: string,
): Promise<void> {
  const user = await requireUser();
  if (!isVisibility(requested)) return;

  try {
    await setNoteVisibility(user.id, noteId, requested);
  } catch (error) {
    if (!(error instanceof NoteNotFoundError)) throw error;
  }

  revalidatePath("/notes");
  revalidatePath("/collections");
}

/** The no-JS path: a real form submit, same validation, same action. */
export async function setNoteVisibilityFormAction(
  noteId: string,
  formData: FormData,
): Promise<void> {
  await setNoteVisibilityAction(noteId, String(formData.get("visibility") ?? ""));
}

function isVisibility(value: string): value is Visibility {
  return Object.values(Visibility).includes(value as Visibility);
}
