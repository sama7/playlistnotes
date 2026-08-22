"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Visibility } from "@prisma/client";
import { CopyButton } from "@/components/copy-button";
import {
  setCollectionVisibilityAction,
  setCollectionVisibilityFormAction,
  setSharedNotesAction,
} from "./share-actions";

/**
 * Share controls, and a plain statement of what a viewer will see.
 *
 * The preview is the point. "Publish" is a decision people make quickly and
 * regret slowly, and the specific fear with this product is reasonable: a
 * collection is annotated, so sharing it *looks* like it might share the
 * annotations. Saying plainly that it does not — next to the control, before
 * the click — is worth more than a settings page explaining it afterwards.
 *
 * The claim is enforced structurally, not by this copy: `getSharedCollection`
 * never selects the notes relation. See lib/collections/service.ts.
 */
export function SharePanel({
  collectionId,
  visibility,
  shareToken,
  baseUrl,
  trackCount,
  notes,
}: {
  collectionId: string;
  visibility: Visibility;
  shareToken: string | null;
  baseUrl: string;
  trackCount: number;
  /** Every note inside this collection, with whether it currently travels. */
  notes: Array<{ id: string; body: string; shared: boolean; trackTitle: string | null }>;
}) {
  const shareUrl = shareToken ? `${baseUrl}/c/${shareToken}` : null;
  const isShared = visibility !== "private";
  const [chosen, setChosen] = useState<Visibility>(visibility);
  const [pending, startTransition] = useTransition();
  const sharedCount = notes.filter((n) => n.shared).length;

  return (
    <section className="share-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Who can see this</strong>
        <span className={`chip ${visibility}`}>{visibility}</span>
      </div>

      {/* The value is handed to the action directly rather than serialised from
          the form — see the note on VisibilityPicker in app/notes/note-row.tsx
          for the two bugs that cost. */}
      <form action={setCollectionVisibilityFormAction.bind(null, collectionId)}>
        <label htmlFor="collection-visibility" className="visually-hidden">
          Who can see this collection
        </label>
        <select
          id="collection-visibility"
          name="visibility"
          value={chosen}
          disabled={pending}
          onChange={(event) => {
            const next = event.currentTarget.value as Visibility;
            setChosen(next);
            startTransition(async () => {
              await setCollectionVisibilityAction(collectionId, next);
            });
          }}
        >
          <option value="private">Private — only you</option>
          <option value="unlisted">Unlisted — anyone with the link</option>
          <option value="public">Public — anyone, may be featured</option>
        </select>
        <noscript>
          <button type="submit">Update</button>
        </noscript>
      </form>

      <p className="note">
        {visibility === "private" ? (
          <>
            Only you can see this. Sharing it would show <strong>{trackCount}</strong>{" "}
            track{trackCount === 1 ? "" : "s"} and the original link.
          </>
        ) : (
          <>
            Anyone with the link can see the track listing — {trackCount} track
            {trackCount === 1 ? "" : "s"}
            {sharedCount > 0 ? (
              <>
                , and the <strong>{sharedCount}</strong> note
                {sharedCount === 1 ? "" : "s"} you ticked below.
              </>
            ) : (
              <>. None of your notes are included.</>
            )}
          </>
        )}
      </p>

      {isShared && notes.length > 0 && (
        /*
          Keyed on which notes are currently shared, so the picker REMOUNTS when
          that changes on the server. Its checkbox state is seeded once from
          props; without the key, saving left the boxes showing what they showed
          before the save, and the next click toggled from a stale baseline —
          the same class of bug as the visibility select, where client state
          outlived the server truth it was seeded from.
        */
        <NotePicker
          key={notes.filter((n) => n.shared).map((n) => n.id).sort().join("|")}
          collectionId={collectionId}
          notes={notes}
        />
      )}

      {shareUrl && (
        <div className="row">
          <CopyButton value={shareUrl} label="Copy the link" />
          <Link href={shareUrl} target="_blank" rel="noopener noreferrer">
            Open what viewers see
          </Link>
        </div>
      )}
      {shareUrl && (
        <p className="note">
          Switching back to private revokes this link rather than just hiding it, un-ticks
          every note, and sharing again issues a new link.
        </p>
      )}
    </section>
  );
}

/**
 * Which notes travel with the collection.
 *
 * Nothing is ticked by default, and that is the invariant surviving in its new
 * form: publishing a collection never publishes the notes inside it — it
 * publishes the ones you chose, one checkbox at a time. Select-all exists
 * because deciding "all of them" is a legitimate single decision; it is not the
 * default, because it must never be one somebody arrives at by not reading.
 */
function NotePicker({
  collectionId,
  notes,
}: {
  collectionId: string;
  notes: Array<{ id: string; body: string; shared: boolean; trackTitle: string | null }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(notes.filter((n) => n.shared).map((n) => n.id)),
  );
  const allSelected = selected.size === notes.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={setSharedNotesAction.bind(null, collectionId)} className="note-picker">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Notes to include</strong>
        <button
          type="button"
          className="linkish"
          onClick={() => setSelected(allSelected ? new Set() : new Set(notes.map((n) => n.id)))}
        >
          {allSelected ? "Select none" : "Select all"}
        </button>
      </div>

      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <label className="checkbox">
              <input
                type="checkbox"
                name="noteId"
                value={note.id}
                checked={selected.has(note.id)}
                onChange={() => toggle(note.id)}
              />
              <span>
                <strong>{note.trackTitle ?? "About the collection"}</strong>
                <span className="note"> {note.body}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <button type="submit">Save what&rsquo;s included</button>
      <p className="note">
        Including a note makes that note itself unlisted, so it stops being private. Any
        note you leave unticked is not on the shared page at all.
      </p>
    </form>
  );
}
