import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  browseNotes,
  defaultDirectionFor,
  hasFilters,
  isSortKey,
  type SortDirection,
  type SortKey,
} from "@/lib/notes/browse";
import { toNoteRow } from "@/lib/notes/list";
import { searchNotes } from "@/lib/notes/search";
import { listTags } from "@/lib/notes/tags";
import { lastfmAuthConfigured, lastfmConfigured } from "@/lib/music/lastfm/client";
import { BrowseBar } from "./browse-bar";
import { LastfmPrompt, Scrobbles } from "./scrobbles";
import { CaptureForm } from "./capture-form";
import { NoteRow } from "./note-row";
import { TagBar } from "./tag-bar";

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
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [params, user] = await Promise.all([searchParams, requireUser()]);
  const query = (params.q ?? "").trim();
  const tagFilter = (params.tag ?? "").trim();

  const importError = params.importError;

  // The sort key comes off the URL, so it is checked against the allowlist
  // rather than cast — a query string must never choose an ordering expression.
  const sort: SortKey = isSortKey(params.sort ?? "") ? (params.sort as SortKey) : "recent";
  const requestedDirection: SortDirection | undefined =
    params.dir === "asc" || params.dir === "desc" ? params.dir : undefined;
  // Names read A→Z; dates read newest first. Each sort brings its own sensible
  // default so the user picks a field, not a field and a direction. The rule
  // lives in one place so the control's wording and the query cannot drift.
  const direction: SortDirection = requestedDirection ?? defaultDirectionFor(sort);

  const filters = {
    track: (params.track ?? "").trim(),
    artist: (params.artist ?? "").trim(),
    album: (params.album ?? "").trim(),
    place: (params.place ?? "").trim(),
    from: (params.from ?? "").trim(),
    to: (params.to ?? "").trim(),
  };
  const activeFilters = Object.values(filters).filter(Boolean).length + (tagFilter ? 1 : 0);

  // Every path is owner-scoped in the query itself, never filtered afterwards.
  const results = query ? await searchNotes(user.id, query) : null;
  const [notes, tags] = await Promise.all([
    query
      ? Promise.resolve([])
      : browseNotes(user.id, {
          tag: tagFilter || undefined,
          track: filters.track || undefined,
          artist: filters.artist || undefined,
          album: filters.album || undefined,
          place: filters.place || undefined,
          // A date input gives a local calendar day; the bounds are widened to
          // cover it so "heard until the 3rd" includes the 3rd.
          from: filters.from ? new Date(`${filters.from}T00:00:00Z`) : undefined,
          to: filters.to ? new Date(`${filters.to}T23:59:59Z`) : undefined,
          sort,
          direction,
        }),
    listTags(user.id),
  ]);

  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3100";
  const tagNames = tags.map((t) => t.name);
  const filtered = hasFilters({
    tag: tagFilter,
    track: filters.track,
    artist: filters.artist,
    album: filters.album,
    place: filters.place,
  }) || Boolean(filters.from || filters.to);

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>Your notes</h1>
          <p className="lede">Private by default. Nothing is shared until you say so.</p>
        </div>
      </header>

      {/* A failed collection import redirects here rather than swallowing the
          reason, so the message has to survive the redirect as a query param. */}
      {importError && (
        <p role="alert" className="error">
          {importError}
        </p>
      )}

      {/*
        The listening strip and the offer to connect one are both gated on the
        server having a Last.fm API key: the integration is feature-flagged, so
        a deployment without one never mentions it. Neither blocks this page —
        `Scrobbles` fetches itself after render.
      */}
      {lastfmConfigured() && user.lastfmUsername && (
        <Scrobbles username={user.lastfmUsername} />
      )}
      {/*
        Gated on the *auth* flag, not merely the key: connecting is the only
        thing this prompt offers, so a server that cannot complete an approval
        must not invite one and then dead-end.
      */}
      {lastfmAuthConfigured() && !user.lastfmUsername && !user.lastfmPromptDismissedAt && (
        <LastfmPrompt />
      )}

      <CaptureForm />

      <BrowseBar
        q={query}
        sort={sort}
        direction={direction}
        filters={filters}
        active={activeFilters}
      />

      {!query && <TagBar tags={tags} active={tagFilter} />}

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
                    <div className="note-head-main">
                      <strong>{r.recordingTitle}</strong>
                      <div className="note">{r.recordingArtist}</div>
                    </div>
                    <span className={`chip ${r.visibility}`}>{r.visibility}</span>
                  </div>
                  <p className="note-body">{r.body}</p>
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
                : filtered
                ? "Nothing matches those filters"
                : "Nothing yet"
              : `${notes.length} note${notes.length === 1 ? "" : "s"}${
                  tagFilter ? ` tagged “${tagFilter}”` : ""
                }`}
          </h2>

          {notes.length === 0 ? (
            <p className="note">
              {filtered ? (
                <>
                  Try widening them, or <Link href="/notes">see everything</Link>.
                </>
              ) : (
                <>
                  Paste a Spotify or Apple Music link above and write the thing you want to
                  remember about it.
                </>
              )}
            </p>
          ) : (
            <ul className="notes">
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={toNoteRow(note)}
                  baseUrl={baseUrl}
                  allTags={tagNames}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
