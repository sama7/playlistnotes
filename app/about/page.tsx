import Link from "next/link";

export const metadata = {
  title: "About",
  description:
    "Why TrackJot exists, what it does with your notes, and what it deliberately doesn't do.",
};

/**
 * The about page.
 *
 * It exists to answer the two questions a private journal has to answer before
 * anyone will write in it: who can see this, and what happens to it. Both are
 * stated plainly here rather than buried in a policy nobody opens.
 */
export default function AboutPage() {
  return (
    <main>
      <p className="eyebrow">About</p>
      <h1>A place to keep what music means to you.</h1>

      <p className="lede">
        TrackJot is a private music journal. You paste a track, write down the thing you
        want to remember, and it&rsquo;s still there in five years — whichever streaming
        service you happen to be using by then.
      </p>

      <section className="prose">
        <h2>Why it works this way</h2>
        <p>
          The first version of this made a streaming account the whole identity: your
          notes lived behind someone else&rsquo;s login and only existed as long as that
          connection did. That was the wrong shape for a journal. TrackJot owns your
          account and keeps its own identifiers for the music, so a link is a
          convenience rather than a dependency. There is no &ldquo;connect your
          streaming service&rdquo; step, and there never will be a required one.
        </p>

        <h2>What a note is attached to</h2>
        <p>
          Usually a track. Sometimes a track <em>in a particular collection</em> —
          &ldquo;this song&rdquo; and &ldquo;this song, third into that playlist&rdquo;
          aren&rsquo;t the same thought, and both are worth keeping. You can also write
          about a collection as a whole.
        </p>
        <p>
          If a link can&rsquo;t be read, or the music isn&rsquo;t on any service, you can
          type in the title and artist yourself. A note is never blocked on metadata.
        </p>

        <h2>Privacy</h2>
        <p>
          Every note starts private and stays private until you choose otherwise. Sharing
          is one item at a time: publishing a collection publishes its track list, and a
          note travels with it only if you tick that note yourself. Everything you
          haven&rsquo;t ticked stays private. Unlisted links aren&rsquo;t indexed by
          search engines.
        </p>
        <p>
          Cover art is shown straight from the streaming services rather than copied
          here, and pages don&rsquo;t send them a referrer.
        </p>

        <h2>Who made it</h2>
        <p>
          A personal project by Samah. It&rsquo;s small on purpose: the notes are the
          product, not a music database.
        </p>
      </section>

      <p style={{ marginTop: "2rem" }}>
        <Link href="/">Back to the start</Link>
      </p>
    </main>
  );
}
