"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importCsvAction, type CsvImportState } from "./import-actions";

/**
 * CSV upload.
 *
 * Kept behind a `<details>` because it is now the minority path — pasting an
 * album or public playlist link is easier and covers most cases. What it is
 * still the *only* way to do is the thing the copy says: a private playlist, or
 * one of Spotify's own editorial playlists, neither of which any API will hand
 * over.
 *
 * A repeat upload is offered as a choice rather than blocked. "I edited a row
 * and re-exported" and "I clicked twice" are different intentions and only the
 * person uploading knows which one this is.
 */
export function CsvImportForm({
  collections,
}: {
  /** Existing collections a file can be imported into, newest first. */
  collections: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<CsvImportState, FormData>(
    importCsvAction,
    {},
  );

  return (
    <details className="csv-import">
      <summary>Import from a CSV export</summary>

      <p className="note">
        For playlists no link can reach — your private ones, and Spotify&rsquo;s own
        editorial playlists. Export with a tool like Exportify and upload the file here.
        We never connect to Exportify or to your Spotify account.
      </p>

      <form action={formAction} className="capture">
        <div className="field">
          <label htmlFor="file">CSV file</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </div>

        <div className="field">
          <label htmlFor="name">Name (optional)</label>
          <input id="name" name="name" placeholder="Defaults to the file name" />
        </div>

        {/*
          Where the rows land. A new collection is the default because that is
          what a first import means; choosing an existing one turns this into
          the same operation as a refresh, previewed the same way.
        */}
        {collections.length > 0 && (
          <div className="pair">
            <div className="field">
              <label htmlFor="targetCollectionId">Import into</label>
              <select id="targetCollectionId" name="targetCollectionId" defaultValue="">
                <option value="">A new collection</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="mode">If it&rsquo;s an existing one</label>
              <select id="mode" name="mode" defaultValue="replace">
                <option value="replace">Replace its tracks with this file</option>
                <option value="append">Add these tracks to it</option>
              </select>
            </div>
          </div>
        )}

        {state.preview && (
          <div className="refresh-preview">
            <strong>What would change in {state.preview.name}</strong>
            <p className="note">
              {state.preview.mode === "replace" ? "Replacing" : "Adding to"} it gives{" "}
              {state.preview.total} track{state.preview.total === 1 ? "" : "s"} —{" "}
              {state.preview.added} added, {state.preview.removed} removed,{" "}
              {state.preview.moved} moved.
            </p>
            {state.preview.orphaning.length > 0 ? (
              <div className="warn">
                <p>
                  <strong>{state.preview.orphaning.length}</strong> of your notes are about
                  tracks this file doesn&rsquo;t contain. They are <strong>kept</strong> and
                  stay in your notes — they just stop being attached to a slot here.
                </p>
                <ul>
                  {state.preview.orphaning.map((n) => (
                    <li key={n.id}>
                      <strong>{n.trackTitle}</strong> — {n.body}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="note">No notes lose their track.</p>
            )}
            {/* Re-submitting the same form carries the file through again; this
                flag is what turns the second submit into the write. */}
            <input type="hidden" name="confirmTarget" value="yes" />
            <p className="note">Choose the file again above, then confirm.</p>
          </div>
        )}

        {state.duplicate && (
          <>
            <p role="status" className="prompt">
              You imported this exact file on {state.duplicate.importedAt}.{" "}
              {state.duplicate.collectionId && (
                <>
                  <Link href={`/collections/${state.duplicate.collectionId}`}>
                    Open what you already have
                  </Link>
                  {" — or "}
                </>
              )}
              import it again as a separate snapshot. Your existing collection and any
              notes on it are left alone either way.
            </p>
            <input type="hidden" name="confirmDuplicate" value="yes" />
          </>
        )}

        {state.error && !state.duplicate && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}

        {state.imported && (
          <p role="status" className="success">
            Imported <strong>{state.imported.name}</strong> — {state.imported.count} track
            {state.imported.count === 1 ? "" : "s"}
            {state.imported.matched > 0 && `, ${state.imported.matched} already in your library`}
            {state.imported.skipped > 0 && `, ${state.imported.skipped} skipped`}.{" "}
            <Link href={`/collections/${state.imported.collectionId}`}>Open it</Link>
          </p>
        )}

        {state.problems && state.problems.length > 0 && (
          <details>
            <summary>Rows that were not imported</summary>
            <ul className="note">
              {state.problems.map((p) => (
                <li key={p.line}>
                  Line {p.line}: {p.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        <button type="submit" disabled={pending}>
          {pending
            ? "Importing…"
            : state.duplicate
              ? "Import again anyway"
              : state.preview
                ? "Yes, change it"
                : "Import"}
        </button>
      </form>
    </details>
  );
}
