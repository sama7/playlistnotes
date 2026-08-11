import { appleDeveloperToken, appleMusicConfigured } from "./developer-token";
import type { AppleCollectionData, AppleTrackData } from "./itunes";

/**
 * Apple Music catalog API — the one Apple capability that needs the paid
 * developer membership.
 *
 * Only playlists live here. Tracks, singles, EPs and albums come from the
 * public iTunes API in `itunes.ts` and need no account at all, so this file
 * being unconfigured costs exactly one feature.
 *
 * A developer token authorises the application. No Music User Token is ever
 * requested, so users never sign into Apple.
 */

const API = "https://api.music.apple.com/v1";
const TIMEOUT_MS = 8_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** Apple requires a storefront in the path; the catalog is region-specific. */
const DEFAULT_STOREFRONT = "us";

export class AppleMusicUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "not-found" | "rate-limited" | "unavailable",
  ) {
    super(message);
    this.name = "AppleMusicUnavailableError";
  }
}

interface RawRelationshipTrack {
  id?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    trackNumber?: number;
    releaseDate?: string;
    isrc?: string;
  };
}

interface RawPlaylist {
  id?: string;
  attributes?: { name?: string; curatorName?: string; description?: { standard?: string } };
  relationships?: { tracks?: { data?: RawRelationshipTrack[]; next?: string } };
}

async function get<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  if (!appleMusicConfigured()) {
    throw new AppleMusicUnavailableError("Apple Music is not configured.", "not-configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(path.startsWith("http") ? path : `${API}${path}`, {
      headers: { authorization: `Bearer ${appleDeveloperToken()}` },
      signal: controller.signal,
      redirect: "error",
    });

    if (response.status === 404) {
      throw new AppleMusicUnavailableError("Not available from Apple Music.", "not-found");
    }
    if (response.status === 429) {
      throw new AppleMusicUnavailableError("Apple Music is rate limiting us.", "rate-limited");
    }
    if (response.status === 401 || response.status === 403) {
      // Almost always a malformed key or a stale token rather than a real
      // permission problem — worth distinguishing in the logs from a 404.
      throw new AppleMusicUnavailableError(
        "Apple Music rejected our developer token.",
        "unavailable",
      );
    }
    if (!response.ok) {
      throw new AppleMusicUnavailableError(`Apple Music returned ${response.status}.`, "unavailable");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AppleMusicUnavailableError) throw error;
    throw new AppleMusicUnavailableError("Could not reach Apple Music.", "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

function shapeTrack(raw: RawRelationshipTrack): AppleTrackData | null {
  const a = raw.attributes;
  if (!raw.id || !a?.name) return null;
  return {
    id: raw.id,
    name: a.name,
    // Apple gives one credit string per track, as in the iTunes API. We store
    // it as given and never split it — see the note in itunes.ts.
    artistName: a.artistName ?? "Unknown artist",
    artistId: null,
    albumId: null,
    albumName: a.albumName ?? null,
    durationMs: typeof a.durationInMillis === "number" ? a.durationInMillis : null,
    trackNumber: typeof a.trackNumber === "number" ? a.trackNumber : null,
    releaseDate: a.releaseDate ?? null,
  };
}

export async function fetchApplePlaylist(
  id: string,
  options: { fetchImpl?: typeof fetch; storefront?: string } = {},
): Promise<AppleCollectionData> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const storefront = options.storefront ?? DEFAULT_STOREFRONT;

  const body = await get<{ data?: RawPlaylist[] }>(
    `/catalog/${storefront}/playlists/${encodeURIComponent(id)}?limit[tracks]=${PAGE_SIZE}`,
    fetchImpl,
  );

  const playlist = body.data?.[0];
  if (!playlist?.id) {
    throw new AppleMusicUnavailableError("That playlist was not found.", "not-found");
  }

  const tracks: AppleTrackData[] = [];
  let page = playlist.relationships?.tracks;
  let pages = 0;

  while (page && pages < MAX_PAGES) {
    for (const raw of page.data ?? []) {
      const shaped = shapeTrack(raw);
      if (shaped) tracks.push(shaped);
    }
    if (!page.next) break;
    pages++;
    const nextBody = await get<{ data?: RawRelationshipTrack[]; next?: string }>(
      `https://api.music.apple.com${page.next}&limit=${PAGE_SIZE}`,
      fetchImpl,
    );
    page = { data: nextBody.data, next: nextBody.next };
  }

  return {
    id: playlist.id,
    name: playlist.attributes?.name ?? "Untitled playlist",
    artistName: playlist.attributes?.curatorName ?? "Unknown curator",
    artistId: null,
    releaseDate: null,
    tracks,
  };
}
