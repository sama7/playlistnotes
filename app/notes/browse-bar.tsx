"use client";

import { useState } from "react";
import Link from "next/link";
import { SORT_OPTIONS, type SortDirection, type SortKey } from "@/lib/notes/browse";

/**
 * Sorting and filtering, as a plain GET form.
 *
 * Everything lands in the URL rather than in component state, which is what
 * makes a view linkable, survivable across a reload, and correct with the back
 * button. It also keeps the query owner-scoped on the server with no client
 * round trip that could be pointed at somebody else's notes.
 *
 * The filter fields are collapsed until asked for. Most visits are "show me
 * what I wrote lately"; six inputs above that would be a form standing between
 * a person and their own archive.
 */
export function BrowseBar({
  q,
  sort,
  direction,
  filters,
  active,
}: {
  q: string;
  sort: SortKey;
  direction: SortDirection;
  filters: { track: string; artist: string; album: string; place: string; from: string; to: string };
  /** How many filters are in play, so a collapsed panel still says so. */
  active: number;
}) {
  const [open, setOpen] = useState(active > 0);

  return (
    <form action="/notes" method="get" className="browse" role="search">
      <div className="browse-line">
        <label className="visually-hidden" htmlFor="q">
          Search your notes
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search your notes — by what you wrote, or by track or artist"
        />
        <button type="submit">Search</button>
      </div>

      <div className="browse-line">
        <label htmlFor="sort" className="note">
          Sort
        </label>
        <select id="sort" name="sort" defaultValue={sort}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label htmlFor="dir" className="visually-hidden">
          Direction
        </label>
        <select id="dir" name="dir" defaultValue={direction}>
          <option value="asc">A → Z / oldest first</option>
          <option value="desc">Z → A / newest first</option>
        </select>

        <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
          {open ? "Fewer filters" : active > 0 ? `Filters (${active})` : "More filters"}
        </button>

        {(active > 0 || q) && (
          <Link href="/notes" className="note">
            Clear
          </Link>
        )}
      </div>

      {open && (
        <div className="browse-filters">
          <div className="field">
            <label htmlFor="track">Track</label>
            <input id="track" name="track" defaultValue={filters.track} />
          </div>
          <div className="field">
            <label htmlFor="artist">Artist</label>
            <input id="artist" name="artist" defaultValue={filters.artist} />
          </div>
          <div className="field">
            <label htmlFor="album">Album</label>
            <input id="album" name="album" defaultValue={filters.album} />
          </div>
          <div className="field">
            <label htmlFor="place">Place</label>
            <input id="place" name="place" defaultValue={filters.place} />
          </div>
          {/* Bounds on when you HEARD it, not on when the note was typed —
              which is the whole reason "experienced at" is a separate column. */}
          <div className="field">
            <label htmlFor="from">Heard from</label>
            <input id="from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="field">
            <label htmlFor="to">Heard until</label>
            <input id="to" name="to" type="date" defaultValue={filters.to} />
          </div>
          <button type="submit">Apply</button>
        </div>
      )}
    </form>
  );
}
