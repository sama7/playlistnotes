/**
 * Normalization used for `recordings.normalized_key`.
 *
 * This key is written on every insert but READ BY NOTHING in the rescue sprint.
 * It exists so that future convergence-based promotion of user-authored
 * recordings (AGENTS.md §3a.5b) is a query rather than a bulk re-normalization
 * of the entire table.
 *
 * It is deliberately NOT an identity: two rows sharing a normalized key are
 * evidence, never proof. Resolution matches on exact (provider, provider_id)
 * first, and a false merge is always worse than a duplicate.
 */

/** Version marker so a future normalization change can be detected and backfilled. */
const KEY_VERSION = "v1";

/** Duration buckets of 5 seconds — tolerant of encoding differences, tight
 *  enough to separate a radio edit from an extended mix. */
const DURATION_BUCKET_MS = 5_000;

const FEATURED_ARTIST_PATTERN =
  /\s*[([]?\s*(feat\.?|featuring|ft\.?|with)\s+[^)\]]*[)\]]?\s*$/gi;

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    // strip combining marks so "Beyoncé" and "Beyonce" agree
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(FEATURED_ARTIST_PATTERN, "")
    // collapse every punctuation-ish character to a single space
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizedKey(input: {
  title: string;
  artistDisplay: string;
  durationMs?: number | null;
}): string {
  const title = normalizeText(input.title);
  const artist = normalizeText(input.artistDisplay);
  const bucket =
    typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
      ? Math.round(input.durationMs / DURATION_BUCKET_MS)
      : "na";

  return `${KEY_VERSION}:${artist}:${title}:${bucket}`;
}

export const __testing = { normalizeText, KEY_VERSION, DURATION_BUCKET_MS };
