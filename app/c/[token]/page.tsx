import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedCollection } from "@/lib/collections/service";

export const dynamic = "force-dynamic";

/**
 * A deliberately shared collection, readable without signing in.
 *
 * Unlisted pages are addressable but must never be discoverable, so `noindex`
 * is set regardless of the global setting.
 *
 * **No note appears here, and that is structural rather than filtered.**
 * `getSharedCollection` selects a narrow shape that does not include the notes
 * relation at all, so there is nothing on this page to accidentally render. A
 * filter is something a future query can forget to apply; an absent relation is
 * not.
 */
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
 * link sees the note; anyone who merely sees it pasted does not.
 */
export const metadata: Metadata = {
  title: "A shared collection",
  description: "Someone shared a collection on TrackJot.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "A shared collection on TrackJot",
    description: "Someone shared a collection on TrackJot.",
  },
};

export default async function SharedCollectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Visibility is re-checked in the query, so un-publishing genuinely revokes
  // access rather than merely hiding the link.
  const collection = await getSharedCollection(token);
  if (!collection) notFound();

  return (
    <main>
      <p className="eyebrow">Shared from TrackJot</p>
      <h1>{collection.name}</h1>
      <p className="lede">
        {collection.tracks.length} track{collection.tracks.length === 1 ? "" : "s"}
        {collection.snapshotAt ? ` · ${collection.snapshotAt.toISOString().slice(0, 10)}` : ""}
      </p>
      {collection.description && <p>{collection.description}</p>}

      {collection.about && <blockquote className="shared-note">{collection.about}</blockquote>}

      <ol className="tracklist">
        {collection.tracks.map((track) => (
          <li key={track.position} className="track">
            <div className="track-line">
              <span className="track-num note">{track.position + 1}</span>
              <div className="track-main">
                <div className="track-title">
                  {track.providerUrl ? (
                    <a href={track.providerUrl} target="_blank" rel="noopener noreferrer">
                      {track.title}
                    </a>
                  ) : (
                    track.title
                  )}
                </div>
                <div className="note">{track.artistDisplay}</div>
              </div>
            </div>
            {/*
              Only notes the owner explicitly ticked reach this page. They come
              from a query that asks for notes and nothing else, gated on a
              per-note boolean — the tracklist query above still cannot return a
              note at all. See lib/collections/service.ts.
            */}
            {track.notes.map((body, index) => (
              <blockquote key={index} className="shared-note">
                {body}
              </blockquote>
            ))}
          </li>
        ))}
      </ol>

      {collection.sourceUrl && (
        <p style={{ marginTop: "1.5rem" }}>
          <a href={collection.sourceUrl} target="_blank" rel="noopener noreferrer">
            Open the original
          </a>
        </p>
      )}

      <p className="note" style={{ marginTop: "2rem" }}>
        This is a track listing someone chose to share. Any notes they wrote about these
        tracks stay private.
      </p>
    </main>
  );
}
