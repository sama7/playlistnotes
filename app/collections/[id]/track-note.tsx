"use client";

import { useActionState, useState } from "react";
import {
  deleteCollectionNoteAction,
  saveCollectionNoteAction,
  type CollectionNoteState,
} from "./actions";

/**
 * The note cell for one track in a collection.
 *
 * Collapsed by default. A playlist is fifty rows, and fifty open textareas is a
 * wall rather than a page — but an existing note is always shown in full,
 * because the reason to open a collection you annotated is to read what you
 * wrote.
 *
 * The collection item id is bound server-side via `bind`, so it is not a form
 * field the browser could alter. Ownership is still re-checked in the action;
 * this only removes the invitation.
 */
export function TrackNote({
  collectionItemId,
  collectionId,
  note,
  trackTitle,
}: {
  collectionItemId: string;
  collectionId: string;
  note: { id: string; body: string } | null;
  trackTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CollectionNoteState, FormData>(
    saveCollectionNoteAction.bind(null, collectionItemId),
    {},
  );

  // A successful save clears the error and the echoed body; close the editor.
  const editing = open || Boolean(state.error);

  if (!editing) {
    return (
      <div className="track-note">
        {note ? (
          <>
            <p className="track-note-body">{note.body}</p>
            <div className="row">
              {/*
                The visible label stays short, but the accessible name carries
                the track. A screen-reader user listing the buttons on a
                fifty-track playlist would otherwise hear "Edit" fifty times
                with nothing to tell them apart.
              */}
              <button
                type="button"
                className="linkish"
                aria-label={`Edit your note about ${trackTitle}`}
                onClick={() => setOpen(true)}
              >
                Edit
              </button>
              <form action={deleteCollectionNoteAction.bind(null, collectionId, note.id)}>
                <button
                  type="submit"
                  className="linkish danger-text"
                  aria-label={`Delete your note about ${trackTitle}`}
                >
                  Delete
                </button>
              </form>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="linkish"
            aria-label={`Add a note about ${trackTitle}`}
            onClick={() => setOpen(true)}
          >
            Add a note
          </button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="track-note inline-edit">
      {note && <input type="hidden" name="noteId" value={note.id} />}
      <label className="visually-hidden" htmlFor={`body-${collectionItemId}`}>
        Your note about {trackTitle}
      </label>
      <textarea
        id={`body-${collectionItemId}`}
        name="body"
        rows={3}
        autoFocus
        defaultValue={state.body ?? note?.body ?? ""}
        placeholder="What do you want to remember about this one, here?"
      />
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="linkish" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
