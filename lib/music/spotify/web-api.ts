/**
 * Spotify Web API via the Client Credentials flow.
 *
 * **No user is authenticated here.** The token authorises the *application*,
 * which is why the five-user Development Mode cap does not engage: that cap
 * counts authorised users, and this flow has none. There is no "Connect
 * Spotify" step, no `/me`, no user token, no OAuth callback.
 *
 * Measured capability, August 10 2026 (re-test before relying on it):
 *   - tracks, albums and their full tracklists: available
 *   - **user-created public playlists: available**, tracklist included
 *   - Spotify's own editorial playlists (`37i9…`): 404, withdrawn from
 *     Development Mode apps
 *   - private playlists: 404, they genuinely need user OAuth
 *
 * Optional throughout. With no credentials configured every function returns
 * null and the caller falls back to oEmbed plus user-supplied metadata, which
 * is what the core independence invariant requires.
 */

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const TIMEOUT_MS = 8_000;

/** Spotify caps page size at 50 for both album and playlist tracks. */
const PAGE_SIZE = 50;

/** Refuse to walk a pathological playlist forever. */
const MAX_PAGES = 20;

import { fromSpotifyImages, type Artwork, type SpotifyImage } from "../artwork";

export interface SpotifyArtistRef {
  id: string;
  name: string;
}

export interface SpotifyTrackData {
  id: string;
  name: string;
  artists: SpotifyArtistRef[];
  /** The display credit, joined the way Spotify presents it. */
  artistDisplay: string;
  durationMs: number | null;
  isrc: string | null;
  album: {
    id: string;
    name: string;
    artists: SpotifyArtistRef[];
    releaseDate: string | null;
    /** Optional: absent from hand-written fixtures and from some responses. */
    artwork?: Artwork;
  } | null;
  trackNumber: number | null;
}

export interface SpotifyCollectionData {
  id: string;
  artwork?: Artwork;
  kind: "album" | "playlist";
  name: string;
  description: string | null;
  /** Present for albums; playlists have an owner instead. */
  artists: SpotifyArtistRef[];
  ownerName: string | null;
  releaseDate: string | null;
  tracks: SpotifyTrackData[];
  /** True when we stopped paginating before the end. */
  truncated: boolean;
}

export class SpotifyUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "not-found" | "rate-limited" | "unavailable",
  ) {
    super(message);
    this.name = "SpotifyUnavailableError";
  }
}

export function spotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

// An app token lasts an hour. Cached in module scope so a burst of imports
// costs one token request rather than one per call.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function appToken(fetchImpl: typeof fetch): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new SpotifyUnavailableError("Spotify is not configured.", "not-configured");
  }

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });

  if (!response.ok) {
    throw new SpotifyUnavailableError("Could not obtain a Spotify token.", "unavailable");
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new SpotifyUnavailableError("Spotify returned no token.", "unavailable");
  }

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** Exposed so tests can reset between cases. */
export function __clearTokenCache() {
  cachedToken = null;
}

async function apiGet<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const token = await appToken(fetchImpl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (response.status === 404) {
      throw new SpotifyUnavailableError("Not available from Spotify.", "not-found");
    }
    if (response.status === 429) {
      // Surfaced rather than retried in-request: making a user wait behind a
      // backoff is worse than telling them to try again.
      throw new SpotifyUnavailableError("Spotify is rate limiting us.", "rate-limited");
    }
    if (!response.ok) {
      throw new SpotifyUnavailableError(`Spotify returned ${response.status}.`, "unavailable");
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SpotifyUnavailableError) throw error;
    throw new SpotifyUnavailableError("Could not reach Spotify.", "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

// --- shaping -----------------------------------------------------------------

interface RawArtist {
  id?: string;
  name?: string;
}
interface RawTrack {
  id?: string;
  name?: string;
  artists?: RawArtist[];
  duration_ms?: number;
  track_number?: number;
  external_ids?: { isrc?: string };
  album?: {
    id?: string;
    name?: string;
    artists?: RawArtist[];
    release_date?: string;
    images?: SpotifyImage[];
  };
  is_local?: boolean;
}

function shapeArtists(raw: RawArtist[] | undefined): SpotifyArtistRef[] {
  return (raw ?? [])
    .filter((a): a is Required<RawArtist> => Boolean(a?.id && a?.name))
    .map((a) => ({ id: a.id, name: a.name }));
}

/**
 * Join artist names the way Spotify's own UI does.
 *
 * This string is display only. Entity linkage always uses the IDs — never this,
 * and never a split of this. That distinction is the whole reason a two-artist
 * track does not get filed under one artist.
 */
function joinArtists(artists: SpotifyArtistRef[]): string {
  return artists.map((a) => a.name).join(", ");
}

function shapeTrack(raw: RawTrack | null | undefined): SpotifyTrackData | null {
  if (!raw?.id || !raw.name) return null;
  // Local files a user added to their own playlist have no stable ID and are
  // not resolvable by anyone else.
  if (raw.is_local) return null;

  const artists = shapeArtists(raw.artists);
  return {
    id: raw.id,
    name: raw.name,
    artists,
    artistDisplay: joinArtists(artists) || "Unknown artist",
    durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
    isrc: raw.external_ids?.isrc ?? null,
    trackNumber: typeof raw.track_number === "number" ? raw.track_number : null,
    album: raw.album?.id
      ? {
          id: raw.album.id,
          name: raw.album.name ?? "",
          artists: shapeArtists(raw.album.artists),
          releaseDate: raw.album.release_date ?? null,
          artwork: fromSpotifyImages(raw.album.images),
        }
      : null,
  };
}

// --- public surface ----------------------------------------------------------

export async function fetchTrack(
  id: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SpotifyTrackData | null> {
  if (!spotifyConfigured()) return null;
  try {
    const raw = await apiGet<RawTrack>(`/tracks/${encodeURIComponent(id)}`, options.fetchImpl ?? fetch);
    return shapeTrack(raw);
  } catch {
    return null;
  }
}

interface RawPage<T> {
  items?: T[];
  next?: string | null;
}

/** Album tracks omit the album object, so it is grafted on from the parent. */
export async function fetchAlbum(
  id: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SpotifyCollectionData> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!spotifyConfigured()) {
    throw new SpotifyUnavailableError("Spotify is not configured.", "not-configured");
  }

  const album = await apiGet<{
    id: string;
    name: string;
    artists?: RawArtist[];
    release_date?: string;
    images?: SpotifyImage[];
    tracks?: RawPage<RawTrack>;
  }>(`/albums/${encodeURIComponent(id)}`, fetchImpl);

  const albumArtists = shapeArtists(album.artists);
  const albumRef = {
    id: album.id,
    name: album.name,
    artists: albumArtists,
    releaseDate: album.release_date ?? null,
    // Album track objects omit the album, so its art has to be grafted on the
    // same way the rest of the album reference already is.
    images: album.images,
  };

  const tracks: SpotifyTrackData[] = [];
  let page = album.tracks;
  let pages = 0;

  while (page && pages < MAX_PAGES) {
    for (const raw of page.items ?? []) {
      const shaped = shapeTrack({ ...raw, album: { ...albumRef, release_date: album.release_date } });
      if (shaped) tracks.push(shaped);
    }
    if (!page.next) break;
    pages++;
    page = await apiGet<RawPage<RawTrack>>(
      `/albums/${encodeURIComponent(id)}/tracks?limit=${PAGE_SIZE}&offset=${tracks.length}`,
      fetchImpl,
    );
  }

  return {
    id: album.id,
    artwork: fromSpotifyImages(album.images),
    kind: "album",
    name: album.name,
    description: null,
    artists: albumArtists,
    ownerName: null,
    releaseDate: album.release_date ?? null,
    tracks,
    truncated: pages >= MAX_PAGES,
  };
}

export async function fetchPlaylist(
  id: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SpotifyCollectionData> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!spotifyConfigured()) {
    throw new SpotifyUnavailableError("Spotify is not configured.", "not-configured");
  }

  const playlist = await apiGet<{
    id: string;
    name: string;
    description?: string;
    owner?: { display_name?: string };
    images?: SpotifyImage[];
    tracks?: RawPage<{ track?: RawTrack | null }>;
  }>(`/playlists/${encodeURIComponent(id)}`, fetchImpl);

  const tracks: SpotifyTrackData[] = [];
  let page = playlist.tracks;
  let pages = 0;

  while (page && pages < MAX_PAGES) {
    for (const item of page.items ?? []) {
      const shaped = shapeTrack(item?.track);
      // Episodes, removed tracks and local files come back null or unusable —
      // skipped rather than faked, and reported to the user as skipped.
      if (shaped) tracks.push(shaped);
    }
    if (!page.next) break;
    pages++;
    page = await apiGet<RawPage<{ track?: RawTrack | null }>>(
      `/playlists/${encodeURIComponent(id)}/tracks?limit=${PAGE_SIZE}&offset=${pages * PAGE_SIZE}`,
      fetchImpl,
    );
  }

  return {
    id: playlist.id,
    // A playlist has its own cover, distinct from any album inside it.
    artwork: fromSpotifyImages(playlist.images),
    kind: "playlist",
    name: playlist.name,
    description: playlist.description?.trim() || null,
    artists: [],
    ownerName: playlist.owner?.display_name ?? null,
    releaseDate: null,
    tracks,
    truncated: pages >= MAX_PAGES,
  };
}

/** One possible match, as Spotify describes it. Nothing is resolved yet. */
export interface SpotifySearchResult {
  providerId: string;
  title: string;
  artistName: string;
  albumName: string | null;
  durationMs: number | null;
  artwork: Artwork;
  providerUrl: string | null;
}

/**
 * Search Spotify's catalog by text.
 *
 * The same role as `searchAppleTracks`: a **suggestion** to put in front of a
 * person, never an identity. Client Credentials authenticates the application,
 * so this costs nothing against the five-user cap.
 *
 * Returns nothing rather than throwing when Spotify is unconfigured or
 * unavailable — a missing suggestion must never block a note.
 */
export async function searchSpotifyTracks(
  term: string,
  limit = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<SpotifySearchResult[]> {
  if (!spotifyConfigured()) return [];

  try {
    const params = new URLSearchParams({
      q: term,
      type: "track",
      limit: String(Math.min(Math.max(limit, 1), 25)),
    });
    const body = await apiGet<{
      tracks?: { items?: Array<RawTrack & { album?: { images?: SpotifyImage[] } }> };
    }>(`/search?${params}`, fetchImpl);

    return (body.tracks?.items ?? [])
      .filter((t): t is typeof t & { id: string; name: string } => Boolean(t.id && t.name))
      .map((t) => ({
        providerId: t.id,
        title: t.name,
        artistName: t.artists?.map((a) => a.name).join(", ") ?? "",
        albumName: t.album?.name ?? null,
        durationMs: t.duration_ms ?? null,
        artwork: fromSpotifyImages(t.album?.images),
        providerUrl: `https://open.spotify.com/track/${t.id}`,
      }));
  } catch {
    return [];
  }
}
