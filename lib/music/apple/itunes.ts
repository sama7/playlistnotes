import type { AppleRef } from "./parse-link";

/**
 * Apple Music metadata via the public iTunes lookup API.
 *
 * **No developer account, no key, no token.** Verified against the live
 * endpoint on 2026-08-10: a track id returns full metadata, and an album id
 * with `entity=song` returns the album plus its complete ordered tracklist
 * (21/21 for a real release). Only Apple Music *playlists* require the paid
 * Apple Developer membership and a signed token — those are a separate,
 * later piece of work.
 *
 * One modelling difference from Spotify matters and is deliberately preserved
 * rather than smoothed over. For a collaboration, Spotify returns an array of
 * artists with individual IDs; **iTunes returns a single `artistName` string
 * and a single `artistId`** — "PARTYNEXTDOOR & Drake" is one entity in Apple's
 * catalogue, with its own id. We link exactly what Apple says. Splitting that
 * string into two artists would be precisely the name-derived entity creation
 * the catalog policy forbids, and it would invent IDs Apple never issued.
 *
 * A consequence worth knowing: the same recording captured from Spotify may
 * carry two linked artists and from Apple only one. Both are truthful to their
 * source. ISRC is the join that reconciles the *recordings* later.
 */

const LOOKUP = "https://itunes.apple.com/lookup";
const TIMEOUT_MS = 6_000;

/** Apple's public API is informally limited to roughly 20 calls a minute. The
 *  database-first ordering in the capture flow is what keeps us well beneath
 *  it: a known track never reaches this file. */
const MAX_TRACKS = 300;

import { fromItunesArtwork, type Artwork } from "../artwork";

export interface AppleTrackData {
  id: string;
  name: string;
  artistName: string;
  artistId: string | null;
  albumId: string | null;
  albumName: string | null;
  durationMs: number | null;
  trackNumber: number | null;
  releaseDate: string | null;
  artwork?: Artwork;
}

export interface AppleCollectionData {
  id: string;
  artwork?: Artwork;
  name: string;
  artistName: string;
  artistId: string | null;
  releaseDate: string | null;
  tracks: AppleTrackData[];
}

interface RawResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistId?: number;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  trackTimeMillis?: number;
  trackNumber?: number;
  trackCount?: number;
  releaseDate?: string;
  artworkUrl100?: string;
}

async function lookup(params: string, fetchImpl: typeof fetch): Promise<RawResult[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${LOOKUP}?${params}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) return null;

    // iTunes answers with text/javascript and occasionally a non-JSON body.
    const body = await response.text();
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const results = (parsed as { results?: unknown }).results;
    return Array.isArray(results) ? (results as RawResult[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function shapeTrack(raw: RawResult): AppleTrackData | null {
  if (raw.wrapperType !== "track" || !raw.trackId || !raw.trackName) return null;
  return {
    id: String(raw.trackId),
    name: raw.trackName,
    artistName: raw.artistName ?? "Unknown artist",
    artistId: raw.artistId ? String(raw.artistId) : null,
    albumId: raw.collectionId ? String(raw.collectionId) : null,
    albumName: raw.collectionName ?? null,
    durationMs: typeof raw.trackTimeMillis === "number" ? raw.trackTimeMillis : null,
    trackNumber: typeof raw.trackNumber === "number" ? raw.trackNumber : null,
    releaseDate: raw.releaseDate ?? null,
    artwork: fromItunesArtwork(raw.artworkUrl100),
  };
}

export async function fetchAppleTrack(
  id: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AppleTrackData | null> {
  const results = await lookup(
    `id=${encodeURIComponent(id)}&entity=song`,
    options.fetchImpl ?? fetch,
  );
  if (!results?.length) return null;
  for (const raw of results) {
    const shaped = shapeTrack(raw);
    if (shaped && shaped.id === id) return shaped;
  }
  return null;
}

/** Album plus its ordered tracklist, in one request. */
export async function fetchAppleAlbum(
  id: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AppleCollectionData | null> {
  const results = await lookup(
    `id=${encodeURIComponent(id)}&entity=song&limit=${MAX_TRACKS}`,
    options.fetchImpl ?? fetch,
  );
  if (!results?.length) return null;

  const collection = results.find((r) => r.wrapperType === "collection");
  if (!collection?.collectionId) return null;

  const tracks = results
    .map(shapeTrack)
    .filter((t): t is AppleTrackData => t !== null)
    .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0));

  return {
    id: String(collection.collectionId),
    name: collection.collectionName ?? "Untitled album",
    artistName: collection.artistName ?? "Unknown artist",
    artistId: collection.artistId ? String(collection.artistId) : null,
    releaseDate: collection.releaseDate ?? null,
    tracks,
  };
}

/** Convenience for the capture flow, which holds an already-parsed ref. */
export async function fetchApple(
  ref: AppleRef,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AppleTrackData | AppleCollectionData | null> {
  if (ref.kind === "track") return fetchAppleTrack(ref.id, options);
  if (ref.kind === "album") return fetchAppleAlbum(ref.id, options);
  return null;
}
