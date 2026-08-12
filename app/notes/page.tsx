import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchNotes } from "@/lib/notes/search";
import { listTags, notesByTag } from "@/lib/notes/tags";
import { CaptureForm } from "./capture-form";
import { NoteRow } from "./note-row";

export const dynamic = "force-dynamic";

// Renders as "Your notes · TrackJot" through the template in app/layout.tsx.
export const metadata = { title: "Your notes" };

/**
 * The notes page, with search.
 *
 * Search is a plain GET form rather than a client component. The query lands in
 * the URL, which means a search is linkable, survives a reload, and works with
 * the back button — all of which a `useState` box would have thrown away for no
 * gain at this size. It also keeps the query owner-scoped on the server with no
 * client round trip that could be pointed at someone else's notes.
 */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const [{ q, tag }, user] = await Promise.all([searchParams, requireUser()]);
  const query = (q ?? "").trim();
  const tagFilter = (tag ?? "").trim();

  // Every path is owner-scoped in the query itself, never filtered afterwards.
  const results = query ? await searchNotes(user.id, query) : null;
  const [notes, tags] = await Promise.all([
    query
      ? Promise.resolve([])
      : tagFilter
        ? notesByTag(user.id, tagFilter)
        : prisma.note.findMany({
            where: { ownerId: user.id },
            orderBy: { updatedAt: "desc" },
            include: {
              recording: { include: { externalIds: true } },
              tags: { include: { tag: true } },
            },
            take: 100,
          }),
    listTags(user.id),
  ]);

  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3100";

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>Your notes</h1>
          <p className="lede">Private by default. Nothing is shared until you say so.</p>
        </div>
        <SignOutButton />
      </header>

      <CaptureForm />

      <form action="/notes" method="get" className="search" role="search">
        <label className="visually-hidden" htmlFor="q">
          Search your notes
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search your notes — by what you wrote, or by track or artist"
        />
        <button type="submit">Search</button>
        {query && (
          <Link href="/notes" className="note">
            Clear
          </Link>
        )}
      </form>

      {tags.length > 0 && !query && (
        <div className="row tag-list" style={{ marginBottom: "1.5rem" }}>
          <span className="note">Tags:</span>
          {tags.map((t) => (
            <Link
              key={t.name}
              href={tagFilter === t.name ? "/notes" : `/notes?tag=${encodeURIComponent(t.name)}`}
              className={`chip tag${tagFilter === t.name ? " active" : ""}`}
            >
              {t.name} <span className="note">{t.count}</span>
            </Link>
          ))}
        </div>
      )}

      {results ? (
        <>
          <h2>
            {results.length === 0
              ? `Nothing matches “${query}”`
              : `${results.length} match${results.length === 1 ? "" : "es"} for “${query}”`}
          </h2>
          {results.length === 0 ? (
            <p className="note">
              Search covers what you wrote and the track and artist it was about. Try fewer
              words, or <Link href="/notes">see everything</Link>.
            </p>
          ) : (
            <ul className="notes">
              {results.map((r) => (
                <li key={r.id} className="note-card">
                  <div className="note-head">
                    <div>
                      <strong>{r.recordingTitle}</strong>
                      <div className="note">{r.recordingArtist}</div>
                    </div>
                    <span className={`chip ${r.visibility}`}>{r.visibility}</span>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.body}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h2>
            {notes.length === 0
              ? tagFilter
                ? `Nothing tagged “${tagFilter}”`
                : "Nothing yet"
              : `${notes.length} note${notes.length === 1 ? "" : "s"}${
                  tagFilter ? ` tagged “${tagFilter}”` : ""
                }`}
          </h2>

          {notes.length === 0 ? (
            <p className="note">
              Paste a Spotify or Apple Music link above and write the thing you want to
              remember about it.
            </p>
          ) : (
            <ul className="notes">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} baseUrl={baseUrl} />
              ))}
            </ul>
          )}
        </>
      )}

      <p className="note" style={{ marginTop: "2rem" }}>
        <Link href="/collections">Collections</Link> · <Link href="/account">Account</Link>
      </p>
    </main>
  );
}
