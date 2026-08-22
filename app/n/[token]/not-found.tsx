import Link from "next/link";

/**
 * What someone sees when a share link no longer works.
 *
 * A bare framework 404 is the wrong answer here. The person holding this link
 * was sent it by someone they know, and "This page could not be found" reads as
 * a broken product rather than as a deliberate act.
 *
 * **The copy is identical whether the link was revoked or never existed**, and
 * that is the point rather than laziness: distinguishing the two would turn this
 * page into an oracle for testing guessed tokens. So it says the honest,
 * non-disclosing thing — this link isn't available — and does not speculate
 * about why.
 */
export default function SharedNoteNotFound() {
  return (
    <main>
      <p className="eyebrow">TrackJot</p>
      <h1>This link isn&rsquo;t available.</h1>
      <p className="lede">
        Either it was never a link, or the person who shared it has made their note
        private again. Notes on TrackJot are private by default, and sharing can always
        be taken back.
      </p>
      <p className="note">
        If you were expecting to read something, ask whoever sent it for a new link.
      </p>
      <p style={{ marginTop: "2rem" }}>
        <Link href="/about">What TrackJot is</Link>
      </p>
    </main>
  );
}
