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
export const metadata: Metadata = {
  robots: { index: false, follow: false },
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

      <ol className="tracklist">
        {collection.tracks.map((track) => (
          <li key={track.position} className="track">
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
