import { appleDeveloperToken, appleMusicConfigured } from "./developer-token";
import { AppleMusicUnavailableError } from "./music-api";
import type { ImportableCollection, ImportableTrack } from "../importable";
import { Provider } from "@prisma/client";

/**
 * Apple Music **catalog** API, with artist relationships.
 *
 * This exists because the public iTunes API flattens a collaboration into a
 * single `artistName` string plus one id — which led me to conclude, wrongly,
 * that Apple models "PARTYNEXTDOOR & Drake" as one entity. It does not. Asked
 * with `include=artists`, the catalog returns two:
 *
 *     artistName attribute : "PARTYNEXTDOOR & Drake"
 *     relationships.artists: 666648192 PARTYNEXTDOOR, 271256 Drake
 *
 * That relationship is how a joint album appears on each artist's page, and it
 * is what lets us link both — the same fidelity Spotify gives.
 *
 * So: use this when a developer token is configured, and fall back to the
 * iTunes API when it is not. The fallback still works; it just links one
 * artist per track instead of all of them.
 */

const API = "https://api.music.apple.com/v1";
const TIMEOUT_MS = 8_000;
const DEFAULT_STOREFRONT = "us";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface RawArtist {
  id?: string;
  attributes?: { name?: string };
}

interface RawSong {
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
  relationships?: { artists?: { data?: RawArtist[] } };
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

function shapeArtists(raw: RawArtist[] | undefined) {
  return (raw ?? [])
    .filter((a): a is { id: string; attributes: { name: string } } =>
      Boolean(a?.id && a.attributes?.name),
    )
    .map((a) => ({ providerId: a.id, name: a.attributes.name }));
}

function shapeSong(
  raw: RawSong,
  album: { providerId: string; name: string; artists: ReturnType<typeof shapeArtists>; releaseDate: string | null } | null,
): ImportableTrack | null {
  const a = raw.attributes;
  if (!raw.id || !a?.name) return null;
  return {
    providerId: raw.id,
    name: a.name,
    // The credit exactly as Apple presents it, never split.
    artistDisplay: a.artistName ?? "Unknown artist",
    // …alongside the entities Apple actually relates it to.
    artists: shapeArtists(raw.relationships?.artists?.data),
    durationMs: typeof a.durationInMillis === "number" ? a.durationInMillis : null,
    isrc: a.isrc ?? null,
    trackNumber: typeof a.trackNumber === "number" ? a.trackNumber : null,
    album,
  };
}

export async function fetchAppleAlbumCatalog(
  id: string,
  options: { fetchImpl?: typeof fetch; storefront?: string } = {},
): Promise<ImportableCollection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const storefront = options.storefront ?? DEFAULT_STOREFRONT;

  const body = await get<{
    data?: Array<{
      id?: string;
      attributes?: { name?: string; artistName?: string; releaseDate?: string };
      relationships?: { artists?: { data?: RawArtist[] }; tracks?: { data?: RawSong[] } };
    }>;
  }>(
    `/catalog/${storefront}/albums/${encodeURIComponent(id)}?include=artists,tracks`,
    fetchImpl,
  );

  const album = body.data?.[0];
  if (!album?.id) throw new AppleMusicUnavailableError("Album not found.", "not-found");

  const albumArtists = shapeArtists(album.relationships?.artists?.data);
  const albumRef = {
    providerId: album.id,
    name: album.attributes?.name ?? "Untitled album",
    artists: albumArtists,
    releaseDate: album.attributes?.releaseDate ?? null,
  };

  // Album track payloads omit their own artist relationships, so each song is
  // re-read to recover them. Worth one request per track for correct linkage.
  const stubs = album.relationships?.tracks?.data ?? [];
  const ids = stubs.map((t) => t.id).filter((v): v is string => Boolean(v));
  const detailed = ids.length
    ? await get<{ data?: RawSong[] }>(
        `/catalog/${storefront}/songs?ids=${ids.slice(0, 300).join(",")}&include=artists`,
        fetchImpl,
      )
    : { data: [] };

  const byId = new Map((detailed.data ?? []).map((s) => [s.id, s]));
  const tracks = stubs
    .map((stub) => shapeSong(byId.get(stub.id) ?? stub, albumRef))
    .filter((t): t is ImportableTrack => t !== null);

  return {
    provider: Provider.apple_music,
    providerId: album.id,
    kind: "album",
    name: albumRef.name,
    description: null,
    sourceUrl: `https://music.apple.com/album/${album.id}`,
    tracks,
    truncated: false,
  };
}

export async function fetchApplePlaylistCatalog(
  id: string,
  options: { fetchImpl?: typeof fetch; storefront?: string } = {},
): Promise<ImportableCollection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const storefront = options.storefront ?? DEFAULT_STOREFRONT;

  const body = await get<{
    data?: Array<{
      id?: string;
      attributes?: { name?: string; curatorName?: string; description?: { standard?: string } };
      relationships?: { tracks?: { data?: RawSong[]; next?: string } };
    }>;
  }>(
    `/catalog/${storefront}/playlists/${encodeURIComponent(id)}?limit[tracks]=${PAGE_SIZE}`,
    fetchImpl,
  );

  const playlist = body.data?.[0];
  if (!playlist?.id) throw new AppleMusicUnavailableError("Playlist not found.", "not-found");

  const stubs: RawSong[] = [];
  let page = playlist.relationships?.tracks;
  let pages = 0;
  while (page && pages < MAX_PAGES) {
    stubs.push(...(page.data ?? []));
    if (!page.next) break;
    pages++;
    const next = await get<{ data?: RawSong[]; next?: string }>(
      `https://api.music.apple.com${page.next}&limit=${PAGE_SIZE}`,
      fetchImpl,
    );
    page = { data: next.data, next: next.next };
  }

  // Hydrate artist relationships in batches of 100 rather than per track.
  const ids = stubs.map((t) => t.id).filter((v): v is string => Boolean(v));
  const hydrated = new Map<string, RawSong>();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const body = await get<{ data?: RawSong[] }>(
      `/catalog/${storefront}/songs?ids=${batch.join(",")}&include=artists`,
      fetchImpl,
    );
    for (const s of body.data ?? []) if (s.id) hydrated.set(s.id, s);
  }

  const tracks = stubs
    .map((stub) => {
      const full = (stub.id && hydrated.get(stub.id)) || stub;
      const a = full.attributes;
      return shapeSong(
        full,
        a?.albumName ? { providerId: "", name: a.albumName, artists: [], releaseDate: a.releaseDate ?? null } : null,
      );
    })
    .filter((t): t is ImportableTrack => t !== null)
    // An album with no id cannot be linked as an entity; drop the stub rather
    // than create an album row keyed on an empty string.
    .map((t) => (t.album?.providerId ? t : { ...t, album: null }));

  return {
    provider: Provider.apple_music,
    providerId: playlist.id,
    kind: "playlist",
    name: playlist.attributes?.name ?? "Untitled playlist",
    description: playlist.attributes?.description?.standard?.trim() || null,
    sourceUrl: `https://music.apple.com/playlist/${playlist.id}`,
    tracks,
    truncated: pages >= MAX_PAGES,
  };
}
