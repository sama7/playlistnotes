import type { Note, Recording, RecordingExternalId } from "@prisma/client";
import {
  deleteNoteAction,
  publishNoteAction,
  rotateShareTokenAction,
  unpublishNoteAction,
  updateNoteAction,
} from "./actions";

type NoteWithRecording = Note & {
  recording: Recording & { externalIds: RecordingExternalId[] };
};

/**
 * One note.
 *
 * Display honours the per-note override before the shared recording, which is
 * what keeps one user's correction from altering what another user saved.
 */
export function NoteRow({ note, baseUrl }: { note: NoteWithRecording; baseUrl: string }) {
  const title = note.displayTitle ?? note.recording.title;
  const artist = note.displayArtist ?? note.recording.artistDisplay;
  const spotify = note.recording.externalIds.find((e) => e.provider === "spotify");
  const shareUrl = note.shareToken ? `${baseUrl}/n/${note.shareToken}` : null;

  return (
    <li className="note-card">
      <div className="note-head">
        <div>
          <strong>{title}</strong>
          <div className="note">{artist}</div>
        </div>
        <span className={`chip ${note.visibility}`}>{note.visibility}</span>
      </div>

      <form action={updateNoteAction.bind(null, note.id)} className="inline-edit">
        <label htmlFor={`body-${note.id}`} className="visually-hidden">
          Note body
        </label>
        <textarea id={`body-${note.id}`} name="body" defaultValue={note.body} rows={3} />
        <div className="row">
          <button type="submit">Save</button>
          {spotify?.providerUrl && (
            <a href={spotify.providerUrl} target="_blank" rel="noopener noreferrer">
              Open in Spotify
            </a>
          )}
        </div>
      </form>

      <div className="row">
        {note.visibility === "private" ? (
          <form action={publishNoteAction.bind(null, note.id)}>
            <button type="submit">Create share link</button>
          </form>
        ) : (
          <>
            <form action={unpublishNoteAction.bind(null, note.id)}>
              <button type="submit">Make private</button>
            </form>
            <form action={rotateShareTokenAction.bind(null, note.id)}>
              <button type="submit">Rotate link</button>
            </form>
          </>
        )}
        <form action={deleteNoteAction.bind(null, note.id)}>
          <button type="submit" className="danger">
            Delete
          </button>
        </form>
      </div>

      {shareUrl && (
        <p className="note">
          Anyone with this link can read this note:{" "}
          <code>{shareUrl}</code>
          <br />
          Rotating the link revokes the old one without deleting the note.
        </p>
      )}
    </li>
  );
}
