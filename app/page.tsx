import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignInButton, SignUpButton } from "@clerk/nextjs";

/**
 * The landing page.
 *
 * It replaces the Checkpoint 1a schema inspector, which listed every recording,
 * collection and note in the database — including other people's private notes —
 * on a route the proxy treats as public. That was correct for a local review of
 * the data model against seeded fiction and became a privacy hole the moment the
 * app was deployed, so it is gone rather than gated.
 *
 * Nothing here reads the database. A landing page that queries on every
 * anonymous request is a free denial-of-service lever, and there is nothing
 * public to count: notes are private by default and the catalog is not a
 * product surface (AGENTS.md §3a).
 */

export default async function Home() {
  const { userId } = await auth();

  // Someone signed in has no use for the pitch; send them to their notes.
  if (userId) redirect("/notes");

  return (
    <main>
      <p className="eyebrow">Playlistnotes</p>
      <h1>A place to keep what music means to you.</h1>
      <p className="lede">
        Paste a track link and write what you actually thought. Your notes stay
        private until you decide otherwise.
      </p>

      <div className="row" style={{ margin: "1.5rem 0 2.5rem" }}>
        <SignUpButton mode="modal">
          <button type="button">Create an account</button>
        </SignUpButton>
        <SignInButton mode="modal">
          <button type="button" className="secondary">
            Sign in
          </button>
        </SignInButton>
      </div>

      <section className="pitch">
        <div>
          <h2>No Spotify account needed</h2>
          <p className="note">
            Sign in with an email code or Google. Playlistnotes owns your account,
            so your notes do not belong to a streaming service and do not vanish
            when you leave one.
          </p>
        </div>
        <div>
          <h2>Paste a link, get the track</h2>
          <p className="note">
            Spotify and Apple Music track, album and public playlist links resolve
            to real recordings with real artists. If a link cannot be read, you can
            still type the track in yourself — a note is never blocked on metadata.
          </p>
        </div>
        <div>
          <h2>Private by default</h2>
          <p className="note">
            Every note starts private. Sharing is a deliberate act, one item at a
            time, and publishing a collection never publishes the notes inside it.
          </p>
        </div>
      </section>

      <footer className="landing-foot">
        <p className="note">
          <Link href="/sign-in">Sign in</Link> · Playlistnotes is a personal
          project by Samah.
        </p>
      </footer>
    </main>
  );
}
