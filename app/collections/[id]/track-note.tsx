"use client";

import { useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
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
 *
 * The action is called from an async form handler rather than through
 * `useActionState` so that a *successful* save can close the editor. With the
 * hook, the returned state is the only signal, and reacting to it means setting
 * state from an effect — a cascading render React now warns about, and a worse
 * way to express "this submit succeeded, so stop editing".
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
  const [state, setState] = useState<CollectionNoteState>({});
  const [saving, setSaving] = useState(false);

  async function save(formData: FormData) {
    setSaving(true);
    const result = await saveCollectionNoteAction(collectionItemId, state, formData);
    setSaving(false);
    setState(result);
    if (!result.error) setOpen(false);
  }

  if (!open) {
    return (
      <div className="track-note">
        {note ? (
          <>
            {/* The body is rendered by the row itself at every width — see
                track-list.tsx. Duplicating it here would show it twice in the
                sheet, which is where the controls live and the content does not. */}
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
              <ConfirmButton
                label="Delete"
                title={`Delete your note about ${trackTitle}?`}
                body={
                  <>
                    <blockquote>{note.body}</blockquote>
                    <p>The track stays in the collection. This can&rsquo;t be undone.</p>
                  </>
                }
                confirmLabel="Delete the note"
                formAction={deleteCollectionNoteAction.bind(null, collectionId, note.id)}
              />
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
    <form action={save} className="track-note inline-edit">
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
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="linkish" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
