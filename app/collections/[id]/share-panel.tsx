import Link from "next/link";
import {
  publishCollectionAction,
  rotateCollectionTokenAction,
  unpublishCollectionAction,
} from "./share-actions";

/**
 * Share controls, and a plain statement of what a viewer will see.
 *
 * The preview is the point. "Publish" is a decision people make quickly and
 * regret slowly, and the specific fear with this product is reasonable: a
 * collection is annotated, so sharing it *looks* like it might share the
 * annotations. Saying plainly that it does not — next to the button, before the
 * click — is worth more than a settings page explaining it afterwards.
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
  annotatedCount,
}: {
  collectionId: string;
  visibility: string;
  shareToken: string | null;
  baseUrl: string;
  trackCount: number;
  annotatedCount: number;
}) {
  const shareUrl = shareToken ? `${baseUrl}/c/${shareToken}` : null;
  const isPrivate = visibility === "private";

  return (
    <section className="share-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Sharing</strong>
        <span className={`chip ${visibility}`}>{visibility}</span>
      </div>

      {isPrivate ? (
        <>
          <p className="note">
            Only you can see this. Publishing gives it an unlisted link — anyone with the
            link can open it, but it is not listed or indexed anywhere.
          </p>
          <p className="note">
            Viewers would see <strong>{trackCount}</strong> track
            {trackCount === 1 ? "" : "s"} and the original link.
            {annotatedCount > 0 && (
              <>
                {" "}
                Your <strong>{annotatedCount}</strong> note
                {annotatedCount === 1 ? "" : "s"} on{" "}
                {annotatedCount === 1 ? "this collection" : "these tracks"}{" "}
                <strong>stay private</strong> — publishing a collection never publishes the
                notes inside it.
              </>
            )}
          </p>
          <form action={publishCollectionAction.bind(null, collectionId)}>
            <button type="submit">Create an unlisted link</button>
          </form>
        </>
      ) : (
        <>
          <p className="note">
            Anyone with this link can see the track listing.
            {annotatedCount > 0 && (
              <>
                {" "}
                Your <strong>{annotatedCount}</strong> note
                {annotatedCount === 1 ? "" : "s"} {annotatedCount === 1 ? "is" : "are"} not
                on that page.
              </>
            )}
          </p>
          {shareUrl && (
            <p className="share-url">
              <code>{shareUrl}</code>
            </p>
          )}
          <div className="row">
            {shareUrl && (
              <Link href={shareUrl} target="_blank" rel="noopener noreferrer">
                Open what viewers see
              </Link>
            )}
            <form action={rotateCollectionTokenAction.bind(null, collectionId)}>
              <button type="submit" className="linkish">
                Reset the link
              </button>
            </form>
            <form action={unpublishCollectionAction.bind(null, collectionId)}>
              <button type="submit" className="linkish danger-text">
                Make private
              </button>
            </form>
          </div>
          <p className="note">
            Resetting breaks the old link immediately. Making it private revokes access
            rather than just hiding it.
          </p>
        </>
      )}
    </section>
  );
}
