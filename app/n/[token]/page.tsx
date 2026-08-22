import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoverArt } from "@/components/cover-art";
import { getSharedNoteView } from "@/lib/notes/service";

export const dynamic = "force-dynamic";

/**
 * Metadata for a deliberately shared note.
 *
 * Static, generic, and containing NOTHING from the note. This is not a
 * stylistic choice: `noindex` stops search engines, and it does not stop the
 * chat, messaging and social clients that fetch a pasted URL to build a preview
 * card. Whatever appears in these fields is shown to every group chat the link
 * is forwarded to, in a way the person who shared it never approved.
 *
 * So the unfurl says the product's name and nothing else. Anyone who opens the
 * link sees the note; anyone who merely sees it pasted does not. **Adding
 * `generateMetadata` to this route is forbidden and tested for** — enriching
 * the page below is safe, enriching the unfurl is not.
 */
export const metadata: Metadata = {
  title: "A shared note",
  description: "Someone shared a note on TrackJot.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "A shared note on TrackJot",
    description: "Someone shared a note on TrackJot.",
  },
};

/**
 * A deliberately shared note, readable without signing in.
 *
 * Every field comes from `getSharedNoteView`, whose select list is the security
 * boundary — the page cannot render what it was never handed, so it cannot leak
 * the owner's id, the note's UUID, its token, or the place it was written.
 */
export default async function SharedNotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Visibility is re-checked in the query, so un-publishing genuinely revokes
  // access rather than merely hiding the link.
  const note = await getSharedNoteView(token);
  if (!note) notFound();

  return (
    <main className="shared">
      <p className="eyebrow">Shared from TrackJot</p>

      <div className="shared-head">
        <CoverArt
          url={note.artworkThumbUrl}
          fullUrl={note.artworkUrl}
          size={160}
          title={note.title}
          className="shared-cover"
        />
        <div>
          <h1>{note.title}</h1>
          {note.artist && <p className="lede">{note.artist}</p>}
          {note.albumTitle && <p className="note album">{note.albumTitle}</p>}
          {note.aboutCollection && (
            <p className="note">About the collection {note.aboutCollection}</p>
          )}
          {note.providerUrl && note.providerName && (
            <p className="note">
              <a href={note.providerUrl} target="_blank" rel="noopener noreferrer">
                Open in {note.providerName}
              </a>
            </p>
          )}
        </div>
      </div>

      <blockquote className="shared-note">{note.body}</blockquote>

      {/*
        The note's own tags, and only those. Tags are a private filing system
        (lib/notes/tags.ts), so this deliberately shows the labels on THIS note
        rather than anything about the writer's wider vocabulary — and they are
        plain text here, not links, because there is nothing an anonymous reader
        could filter.
      */}
      {note.tags.length > 0 && (
        <div className="row tag-list">
          {note.tags.map((name) => (
            <span key={name} className="chip tag">
              {name}
            </span>
          ))}
        </div>
      )}

      <p className="note shared-by">
        {note.author ? (
          <>
            Shared by <strong>{note.author}</strong>. This is one note they chose to
            share; their other notes are private.
          </>
        ) : (
          <>This is one note someone chose to share. Their other notes are private.</>
        )}
      </p>
    </main>
  );
}
