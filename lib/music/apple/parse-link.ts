/**
 * Parsing Apple Music links.
 *
 * Same contract as the Spotify parser: recognise what was pasted, and refuse
 * anything that is not an official Apple address before any network call is
 * contemplated.
 *
 * Apple's URL shape has one quirk that matters. A *track* is addressed as an
 * album URL carrying `?i=<trackId>`:
 *
 *   album  https://music.apple.com/us/album/some-album/1796475285
 *   track  https://music.apple.com/us/album/some-album/1796475285?i=1796475286
 *
 * So the presence of `i` is what distinguishes them, and dropping query
 * parameters wholesale — which is right for Spotify's `si` — would silently
 * turn every pasted track into its album.
 */

const APPLE_HOSTS = new Set(["music.apple.com", "itunes.apple.com", "geo.music.apple.com"]);

/** Apple catalogue IDs are numeric; playlist IDs are `pl.` followed by a slug. */
const NUMERIC_ID = /^\d{4,20}$/;
const PLAYLIST_ID = /^pl\.[A-Za-z0-9-]{4,64}$/;

export type AppleEntity = "track" | "album" | "artist" | "playlist";

export type AppleRef =
  | { kind: "track"; id: string; albumId: string; canonicalUrl: string }
  | { kind: "album" | "artist"; id: string; canonicalUrl: string }
  | { kind: "playlist"; id: string; canonicalUrl: string }
  | { kind: "unsupported"; reason: AppleUnsupportedReason };

export type AppleUnsupportedReason =
  | "empty"
  | "not-a-url"
  | "wrong-scheme"
  | "wrong-host"
  | "unknown-path"
  | "malformed-id"
  | "unsupported-entity";

/** Storefront segments look like `us`, `gb`, `pt-br`. */
function stripStorefront(segments: string[]): string[] {
  const [first] = segments;
  return first && /^[a-z]{2}(-[a-z]{2})?$/i.test(first) ? segments.slice(1) : segments;
}

export function appleTrackUrl(albumId: string, trackId: string): string {
  return `https://music.apple.com/album/${albumId}?i=${trackId}`;
}
export function appleAlbumUrl(id: string): string {
  return `https://music.apple.com/album/${id}`;
}

export function parseAppleMusicLink(input: string): AppleRef {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "unsupported", reason: "empty" };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { kind: "unsupported", reason: "not-a-url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "unsupported", reason: "wrong-scheme" };
  }
  if (!APPLE_HOSTS.has(url.hostname.toLowerCase())) {
    return { kind: "unsupported", reason: "wrong-host" };
  }

  const segments = stripStorefront(url.pathname.split("/").filter(Boolean));
  const entity = segments[0]?.toLowerCase();
  // The slug between the entity and the id is decorative and may be absent.
  const id = segments[segments.length - 1];

  if (!entity || !id) return { kind: "unsupported", reason: "unknown-path" };

  switch (entity) {
    case "album": {
      if (!NUMERIC_ID.test(id)) return { kind: "unsupported", reason: "malformed-id" };
      const trackId = url.searchParams.get("i");
      if (trackId) {
        if (!NUMERIC_ID.test(trackId)) return { kind: "unsupported", reason: "malformed-id" };
        return {
          kind: "track",
          id: trackId,
          albumId: id,
          canonicalUrl: appleTrackUrl(id, trackId),
        };
      }
      return { kind: "album", id, canonicalUrl: appleAlbumUrl(id) };
    }
    case "artist": {
      if (!NUMERIC_ID.test(id)) return { kind: "unsupported", reason: "malformed-id" };
      return { kind: "artist", id, canonicalUrl: `https://music.apple.com/artist/${id}` };
    }
    case "playlist": {
      if (!PLAYLIST_ID.test(id)) return { kind: "unsupported", reason: "malformed-id" };
      return { kind: "playlist", id, canonicalUrl: `https://music.apple.com/playlist/${id}` };
    }
    default:
      return { kind: "unsupported", reason: "unsupported-entity" };
  }
}
