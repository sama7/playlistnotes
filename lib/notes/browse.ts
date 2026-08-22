import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NOTE_LIST_INCLUDE, type NoteWithSubject } from "@/lib/notes/list";
import { normalizeTagName } from "@/lib/notes/tags";

/**
 * Browsing your own notes: sorting, and filtering by the things a note is
 * actually about.
 *
 * The page previously offered "everything, newest first" and a tag filter, so
 * finding a note meant remembering your own wording well enough for full-text
 * search. People do not think that way about their own archive — they think
 * "that Nusrat one", "the ones from the Toronto trip", "everything off IGOR".
 *
 * Two rules hold throughout:
 *
 *   1. **Owner scope is in the WHERE clause, never a filter afterwards.** Every
 *      branch below composes onto `{ ownerId }`, so a bug in a filter can return
 *      the wrong subset of *your* notes and can never reach anyone else's.
 *   2. **Sorting is on an allowlist.** The sort key comes from a query string;
 *      mapping it through a fixed table rather than interpolating it keeps a URL
 *      from choosing arbitrary SQL.
 */

export const SORT_OPTIONS = [
  { value: "recent", label: "Recently written" },
  { value: "experienced", label: "When you heard it" },
  { value: "track", label: "Track name" },
  { value: "artist", label: "Artist name" },
  { value: "album", label: "Album name" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["value"];
export type SortDirection = "asc" | "desc";

export function isSortKey(value: string): value is SortKey {
  return SORT_OPTIONS.some((o) => o.value === value);
}

/**
 * Ordering, as Prisma's `orderBy`.
 *
 * Sorting by track, artist or album orders on the *recording*, which is why
 * these are relation orderings rather than columns on `notes`. Prisma only
 * accepts a plain direction through a relation, so a note about a collection —
 * which has no recording — falls wherever PostgreSQL puts nulls. That is
 * acceptable for a handful of rows and not worth a raw query to control.
 * `experiencedAt` is a scalar, so it can say `nulls: "last"` and does: an
 * undated note is not "the oldest", it is undated.
 *
 * The display override is deliberately NOT part of the sort. It would need a
 * `COALESCE` across a relation that Prisma cannot express in `orderBy`, and the
 * override exists to correct a *display*, not to re-file the note.
 */
function orderFor(sort: SortKey, direction: SortDirection): Prisma.NoteOrderByWithRelationInput[] {
  switch (sort) {
    case "track":
      return [{ recording: { title: direction } }, { createdAt: "desc" }];
    case "artist":
      return [{ recording: { artistDisplay: direction } }, { createdAt: "desc" }];
    case "album":
      return [{ recording: { album: { title: direction } } }, { createdAt: "desc" }];
    case "experienced":
      return [{ experiencedAt: { sort: direction, nulls: "last" } }, { createdAt: "desc" }];
    case "recent":
    default:
      return [{ updatedAt: direction }];
  }
}

export interface BrowseFilters {
  tag?: string;
  /** Substring, case-insensitive. Separate fields so "IGOR" finds the album. */
  track?: string;
  artist?: string;
  album?: string;
  place?: string;
  /** Bounds on when the listening happened, not on when the note was written. */
  from?: Date;
  to?: Date;
}

export interface BrowseOptions extends BrowseFilters {
  sort?: SortKey;
  direction?: SortDirection;
  limit?: number;
}

/** True when any filter beyond the default listing is in play. */
export function hasFilters(filters: BrowseFilters): boolean {
  return Object.values(filters).some((v) => v !== undefined && v !== "");
}

export async function browseNotes(
  ownerId: string,
  options: BrowseOptions = {},
): Promise<NoteWithSubject[]> {
  const {
    sort = "recent",
    direction = sort === "track" || sort === "artist" || sort === "album" ? "asc" : "desc",
    limit = 100,
  } = options;

  const contains = (value: string | undefined) =>
    value?.trim() ? { contains: value.trim(), mode: Prisma.QueryMode.insensitive } : undefined;

  const recordingFilter: Prisma.RecordingWhereInput = {};
  if (contains(options.track)) recordingFilter.title = contains(options.track);
  if (contains(options.artist)) recordingFilter.artistDisplay = contains(options.artist);
  if (contains(options.album)) {
    /**
     * An album match has to consider both places the name can live: the linked
     * `albums` row when the track came from a provider with an album id, and the
     * denormalized `release_title` when it did not. Checking only the relation
     * would silently miss every manually entered note.
     */
    recordingFilter.OR = [
      { album: { title: contains(options.album) } },
      { releaseTitle: contains(options.album) },
    ];
  }

  const where: Prisma.NoteWhereInput = { ownerId };

  if (Object.keys(recordingFilter).length > 0) where.recording = recordingFilter;

  const tag = options.tag ? normalizeTagName(options.tag) : "";
  if (tag) where.tags = { some: { tag: { ownerId, name: tag } } };

  if (contains(options.place)) where.placeLabel = contains(options.place);

  if (options.from || options.to) {
    where.experiencedAt = {
      ...(options.from ? { gte: options.from } : {}),
      ...(options.to ? { lte: options.to } : {}),
    };
  }

  return prisma.note.findMany({
    where,
    orderBy: orderFor(sort, direction),
    include: NOTE_LIST_INCLUDE,
    take: Math.min(Math.max(limit, 1), 200),
  });
}
