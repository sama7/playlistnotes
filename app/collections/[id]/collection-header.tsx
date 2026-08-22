"use client";

import { useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { CoverArt } from "@/components/cover-art";
import { formatDay } from "@/lib/format-date";
import type { RefreshOutcome } from "@/lib/collections/refresh";
import {
  applyRefreshAction,
  deleteCollectionAction,
  previewRefreshAction,
  renameCollectionAction,
} from "./share-actions";
import { saveCollectionRootNoteAction } from "./actions";
import type { CollectionNoteState } from "./actions";

/**
 * The head of a collection page: what it is, when it arrived, what you thought
 * of it, and the two controls that were missing entirely — rename and delete.
 *
 * A collection imported from a link gets the provider's name, which is often
 * not what the owner would call it ("aug23"), and there was no way to change it
 * or to remove a collection added by mistake. Both are basic, and their absence
 * made the page feel read-only.
 */
export function CollectionHeader({
  collectionId,
  name,
  description,
  kindLabel,
  artworkUrl,
  trackCount,
  annotatedCount,
  timestamps,
  sourceUrl,
  sourceName,
  canRefresh,
  refreshedAt,
  rootNote,
}: {
  collectionId: string;
  name: string;
  description: string | null;
  kindLabel: string;
  artworkUrl: string | null;
  trackCount: number;
  annotatedCount: number;
  timestamps: string;
  sourceUrl: string | null;
  /** "Spotify", "Apple Music" — for an honest link label. */
  sourceName: string | null;
  canRefresh: boolean;
  refreshedAt: Date | null;
  rootNote: { id: string; body: string } | null;
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <header className="collection-head">
      <CoverArt url={artworkUrl} size={220} className="collection-cover" />

      <div className="collection-meta">
        <p className="eyebrow">{kindLabel}</p>

        {renaming ? (
          <form
            action={async (formData) => {
              await renameCollectionAction(collectionId, formData);
              setRenaming(false);
            }}
            className="inline-edit"
          >
            <label htmlFor="collection-name" className="visually-hidden">
              Collection name
            </label>
            <input id="collection-name" name="name" defaultValue={name} autoFocus required />
            <label htmlFor="collection-description" className="visually-hidden">
              Description
            </label>
            <input
              id="collection-description"
              name="description"
              defaultValue={description ?? ""}
              placeholder="Description (optional)"
            />
            <div className="row">
              <button type="submit">Save</button>
              <button type="button" className="linkish" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <h1>{name}</h1>
            {description && <p className="lede">{description}</p>}
          </>
        )}

        <p className="note">
          {trackCount} track{trackCount === 1 ? "" : "s"}
          {annotatedCount > 0 && ` · ${annotatedCount} annotated`}
          {timestamps && ` · ${timestamps}`}
          {refreshedAt && ` · refreshed ${formatDay(refreshedAt)}`}
        </p>

        <div className="row actions">
          {!renaming && (
            <button type="button" className="linkish" onClick={() => setRenaming(true)}>
              Rename
            </button>
          )}
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Open in {sourceName ?? "the source"}
            </a>
          )}
          {canRefresh && <RefreshControl collectionId={collectionId} />}
          <ConfirmButton
            label="Delete collection"
            title={`Delete “${name}”?`}
            body={
              <>
                <p>
                  Notes you wrote about individual tracks are <strong>kept</strong> — they
                  become notes about those tracks and stay in your list.
                </p>
                <p>A note about the collection itself goes with it.</p>
              </>
            }
            confirmLabel="Delete the collection"
            formAction={deleteCollectionAction.bind(null, collectionId)}
          />
        </div>

        <RootNote collectionId={collectionId} note={rootNote} name={name} />
      </div>
    </header>
  );
}

/**
 * The note about the whole collection.
 *
 * Separate from the per-track notes on purpose: "this playlist got me through
 * February" is not a statement about track seven, and attaching it to one would
 * be a small lie that gets harder to unpick later.
 */
function RootNote({
  collectionId,
  note,
  name,
}: {
  collectionId: string;
  note: { id: string; body: string } | null;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CollectionNoteState>({});
  const [saving, setSaving] = useState(false);

  // Called from an async form handler rather than through `useActionState`, so
  // that a successful save can close the editor without setting state from an
  // effect. See the note in track-note.tsx.
  async function save(formData: FormData) {
    setSaving(true);
    const result = await saveCollectionRootNoteAction(collectionId, state, formData);
    setSaving(false);
    setState(result);
    if (!result.error) setOpen(false);
  }

  if (!open) {
    return (
      <div className="root-note">
        {note ? (
          <>
            <p className="note-body">{note.body}</p>
            <button type="button" className="linkish" onClick={() => setOpen(true)}>
              Edit this note
            </button>
          </>
        ) : (
          <button type="button" className="linkish" onClick={() => setOpen(true)}>
            Write about {name} as a whole
          </button>
        )}
      </div>
    );
  }

  return (
    <form action={save} className="root-note inline-edit">
      {note && <input type="hidden" name="noteId" value={note.id} />}
      <label htmlFor="root-note-body" className="visually-hidden">
        Your note about {name}
      </label>
      <textarea
        id="root-note-body"
        name="body"
        rows={3}
        autoFocus
        defaultValue={state.body ?? note?.body ?? ""}
        placeholder="What is this collection to you?"
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

/**
 * Re-read the playlist from where it came from.
 *
 * Two steps, never one. The first asks the provider what the playlist looks like
 * now and reports what would change — including, in full, every note that would
 * come unstuck from a track that is no longer there. Only then is there anything
 * to confirm.
 *
 * This is the whole reason the collection stopped being an immutable snapshot
 * and did not simply become mutable: a refresh is allowed to move things, and it
 * is not allowed to surprise you.
 */
function RefreshControl({ collectionId }: { collectionId: string }) {
  const [state, setState] = useState<RefreshOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * `finally` is doing real work here. An earlier version cleared the busy flag
   * on the line after the await, so a Server Action that *threw* left the button
   * reading "Checking…" for the rest of the session with no way back. A network
   * failure has to end with a control the user can press again.
   */
  async function preview() {
    setBusy(true);
    try {
      setState(await previewRefreshAction(collectionId));
    } catch {
      setState({ ok: false, message: "We couldn't check the source just now. Nothing changed." });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const result = await applyRefreshAction(collectionId);
      // A successful apply clears the panel; the page re-renders with the new
      // tracklist behind it, so leaving the preview up would describe the past.
      setState(result.ok && result.applied ? null : result);
    } catch {
      setState({ ok: false, message: "The refresh didn't complete. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="linkish" onClick={preview} disabled={busy}>
        {busy ? "Checking…" : "Refresh from source"}
      </button>

      {state && !state.ok && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}

      {state?.ok && !state.applied && (
        <div className="refresh-preview">
          <strong>What would change</strong>
          <p className="note">
            Re-reading {state.preview.sourceLabel}: {state.preview.total} track
            {state.preview.total === 1 ? "" : "s"} — {state.preview.added} added,{" "}
            {state.preview.removed} removed, {state.preview.moved} moved.
          </p>

          {state.preview.orphaning.length > 0 ? (
            <div className="warn">
              <p>
                <strong>{state.preview.orphaning.length}</strong> of your notes are about
                tracks that are no longer in this playlist. They will be{" "}
                <strong>kept</strong> and will stay in your notes — they just stop being
                attached to a slot in this collection.
              </p>
              <ul>
                {state.preview.orphaning.map((n) => (
                  <li key={n.id}>
                    <strong>{n.trackTitle}</strong> — {n.body}
                  </li>
                ))}
              </ul>
              <p className="note">
                If you would rather delete one first, cancel and do that — nothing has
                changed yet.
              </p>
            </div>
          ) : (
            <p className="note">No notes lose their track.</p>
          )}

          <div className="row">
            <button type="button" onClick={apply} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh it"}
            </button>
            <button type="button" className="linkish" onClick={() => setState(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
