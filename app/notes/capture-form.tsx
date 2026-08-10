"use client";

import { useActionState } from "react";
import Link from "next/link";
import { captureAndCreateNote, type CaptureState } from "./actions";

/**
 * The capture form.
 *
 * Title and artist stay editable at all times rather than appearing only on
 * failure. Spotify's oEmbed returns a title string with no separate artist
 * field, so even a successful lookup cannot fully populate a recording — and
 * the user is the authority on what they meant.
 */
export function CaptureForm() {
  const [state, formAction, pending] = useActionState<CaptureState, FormData>(
    captureAndCreateNote,
    {},
  );

  return (
    <form action={formAction} className="capture">
      <div className="field">
        <label htmlFor="link">Spotify link</label>
        <input
          id="link"
          name="link"
          type="text"
          inputMode="url"
          placeholder="Track, album or playlist — paste any Spotify link"
          defaultValue={state.values?.link ?? ""}
          aria-describedby={state.error ? "capture-error" : undefined}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="body">Your note <span className="note">(for a track)</span></label>
        <textarea
          id="body"
          name="body"
          rows={4}
          placeholder="What do you want to remember about this track?"
          defaultValue={state.values?.body ?? ""}
        />
      </div>

      <details open={state.needsMetadata}>
        <summary>Title and artist{state.needsMetadata ? " — needed" : " (optional)"}</summary>
        <div className="pair">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" defaultValue={state.values?.title ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="artistDisplay">Artist</label>
            <input
              id="artistDisplay"
              name="artistDisplay"
              defaultValue={state.values?.artistDisplay ?? ""}
            />
          </div>
        </div>
        <p className="note">
          Spotify&rsquo;s public preview gives a title but never a separate artist, so this is
          sometimes the only way we can get it right.
        </p>
      </details>

      {state.imported && (
        <p role="status" className="success">
          Imported <strong>{state.imported.name}</strong> — {state.imported.count} track
          {state.imported.count === 1 ? "" : "s"}
          {state.imported.matched > 0 && ` (${state.imported.matched} already in your library)`}.{" "}
          <Link href="/collections">See your collections</Link>
        </p>
      )}

      {state.error && (
        // Asking for the artist is the normal path, not a failure: Spotify's
        // oEmbed has no artist field at all, so a first paste always lands
        // here. Styling it as an error would put a red box in front of every
        // user on every capture.
        <p
          id="capture-error"
          role={state.needsMetadata ? "status" : "alert"}
          className={state.needsMetadata ? "prompt" : "error"}
        >
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? "Working…" : "Save"}
      </button>
    </form>
  );
}
