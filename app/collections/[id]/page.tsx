import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TrackNote } from "./track-note";
import { SharePanel } from "./share-panel";

export const dynamic = "force-dynamic";

/**
 * One collection snapshot, and the place notes get written in playlist context.
 *
 * The page was read-only until now, which made the schema's central idea
 * unreachable: `notes.collection_item_id` exists so that "this song, third into
 * this playlist" is a different thing to say than "this song". A collection you
 * can look at but not annotate is a track listing.
 */
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);

  // Owner-scoped in the query: a valid id belonging to someone else is a 404,
  // indistinguishable from one that never existed.
  const collection = await prisma.collection.findFirst({
    where: { id, ownerId: user.id },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: {
          recording: {
            include: {
              artists: { orderBy: { position: "asc" }, include: { artist: true } },
              externalIds: true,
            },
          },
          // Scoped to this user even though the collection is already theirs:
          // the relation is not itself owner-scoped, and defence in depth here
          // costs nothing.
          notes: { where: { ownerId: user.id }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!collection) notFound();

  const annotated = collection.items.filter((i) => i.notes.length > 0).length;
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3100";

  return (
    <main>
      <p className="eyebrow">Collection snapshot</p>
      <h1>{collection.name}</h1>
      <p className="lede">
        {collection.items.length} track{collection.items.length === 1 ? "" : "s"}
        {annotated > 0 ? ` · ${annotated} annotated` : ""}
        {collection.sourceSnapshotAt
          ? ` · imported ${collection.sourceSnapshotAt.toISOString().slice(0, 10)}`
          : ""}
      </p>
      {collection.sourceUrl && (
        <p className="note">
          <a href={collection.sourceUrl} target="_blank" rel="noopener noreferrer">
            Open the original
          </a>
        </p>
      )}

      <SharePanel
        collectionId={collection.id}
        visibility={collection.visibility}
        shareToken={collection.shareToken}
        baseUrl={baseUrl}
        trackCount={collection.items.length}
        annotatedCount={annotated}
      />

      <ol className="tracklist">
        {collection.items.map((item) => {
          const external = item.recording.externalIds[0];
          const artists =
            item.recording.artists.length > 0
              ? item.recording.artists.map((ra) => ra.artist.name).join(", ")
              : item.recording.artistDisplay;

          return (
            <li key={item.id} className="track">
              <span className="track-num note">{item.position + 1}</span>
              <div className="track-main">
                <div className="track-title">
                  {external?.providerUrl ? (
                    <a href={external.providerUrl} target="_blank" rel="noopener noreferrer">
                      {item.recording.title}
                    </a>
                  ) : (
                    item.recording.title
                  )}
                </div>
                {/* Linked entities where we have them, the raw credit where we
                    do not. The display string is never reconstructed from the
                    entities, so an artist we failed to link is still shown. */}
                <div className="note">{artists}</div>

                <TrackNote
                  collectionItemId={item.id}
                  collectionId={collection.id}
                  trackTitle={item.recording.title}
                  note={item.notes[0] ? { id: item.notes[0].id, body: item.notes[0].body } : null}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <p className="note" style={{ marginTop: "2rem" }}>
        <Link href="/collections">All collections</Link> · <Link href="/notes">Notes</Link>
      </p>
    </main>
  );
}
