import type { Note } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Owner-scoped note search.
 *
 * Two properties matter more than ranking quality:
 *
 *   1. **It is scoped by owner in the query**, so search can never become a way
 *      to read someone else's private writing. Filtering results afterwards
 *      would be one forgotten branch away from a leak.
 *   2. **It searches the recording too**, because people look for "that Drake
 *      note" far more often than they remember their own wording.
 *
 * PostgreSQL's own full-text search, no new infrastructure. `websearch_to_tsquery`
 * accepts what people actually type — quoted phrases, `or`, leading `-` to
 * exclude — and, unlike `to_tsquery`, does not throw on unbalanced input.
 */

export interface NoteSearchResult {
  id: string;
  body: string;
  visibility: Note["visibility"];
  updatedAt: Date;
  recordingTitle: string;
  recordingArtist: string;
  rank: number;
}

export async function searchNotes(
  ownerId: string,
  query: string,
  limit = 50,
): Promise<NoteSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const take = Math.min(Math.max(limit, 1), 200);

  /**
   * Weighting says what a match means: A for the note body (the user's own
   * words), B for title and artist. A body hit therefore outranks an artist
   * hit, which matches how people search their own writing.
   *
   * Parameterised throughout — the query text is never interpolated.
   */
  return prisma.$queryRaw<NoteSearchResult[]>`
    SELECT
      n.id,
      n.body,
      n.visibility,
      n.updated_at AS "updatedAt",
      COALESCE(n.display_title,  r.title)          AS "recordingTitle",
      COALESCE(n.display_artist, r.artist_display) AS "recordingArtist",
      ts_rank(
        setweight(to_tsvector('english', n.body), 'A') ||
        setweight(to_tsvector('english', COALESCE(n.display_title,  r.title)), 'B') ||
        setweight(to_tsvector('english', COALESCE(n.display_artist, r.artist_display)), 'B'),
        websearch_to_tsquery('english', ${trimmed})
      ) AS rank
    FROM notes n
    JOIN recordings r ON r.id = n.recording_id
    WHERE n.owner_id = ${ownerId}::uuid
      AND (
        setweight(to_tsvector('english', n.body), 'A') ||
        setweight(to_tsvector('english', COALESCE(n.display_title,  r.title)), 'B') ||
        setweight(to_tsvector('english', COALESCE(n.display_artist, r.artist_display)), 'B')
      ) @@ websearch_to_tsquery('english', ${trimmed})
    ORDER BY rank DESC, n.updated_at DESC
    LIMIT ${take}
  `;
}
