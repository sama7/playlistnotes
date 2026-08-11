import { Provider } from "@prisma/client";
import type { SpotifyCollectionData } from "./spotify/web-api";
import type { AppleCollectionData, AppleTrackData } from "./apple/itunes";

/**
 * The provider-neutral shape the importer works in.
 *
 * Spotify and Apple describe the same music very differently, and the whole
 * point of an adapter boundary is that the importer never learns which one it
 * is holding. Each provider maps into this; nothing downstream branches on
 * provider again.
 *
 * The difference that must survive translation: **Spotify supplies an ordered
 * list of artists with individual IDs; Apple supplies one credit string and,
 * from the iTunes API, one artist ID for the whole credit.** So `artists` may
 * legitimately be empty while `artistDisplay` is populated. Inventing entries
 * to make the shapes match would mean deriving artists from a name, which is
 * exactly what the catalog policy forbids.
 */

export interface ImportableArtist {
  providerId: string;
  name: string;
}

export interface ImportableTrack {
  providerId: string;
  name: string;
  /** Always present. The credit exactly as the provider gave it. */
  artistDisplay: string;
  /** May be empty when the provider does not break the credit into entities. */
  artists: ImportableArtist[];
  durationMs: number | null;
  isrc: string | null;
  trackNumber: number | null;
  album: {
    providerId: string;
    name: string;
    artists: ImportableArtist[];
    releaseDate: string | null;
  } | null;
}

export interface ImportableCollection {
  provider: Provider;
  providerId: string;
  kind: "album" | "playlist";
  name: string;
  description: string | null;
  sourceUrl: string;
  tracks: ImportableTrack[];
  truncated: boolean;
}

export function fromSpotifyCollection(data: SpotifyCollectionData): ImportableCollection {
  return {
    provider: Provider.spotify,
    providerId: data.id,
    kind: data.kind,
    name: data.name,
    description: data.description,
    sourceUrl: `https://open.spotify.com/${data.kind}/${data.id}`,
    truncated: data.truncated,
    tracks: data.tracks.map((t) => ({
      providerId: t.id,
      name: t.name,
      artistDisplay: t.artistDisplay,
      artists: t.artists.map((a) => ({ providerId: a.id, name: a.name })),
      durationMs: t.durationMs,
      isrc: t.isrc,
      trackNumber: t.trackNumber,
      album: t.album
        ? {
            providerId: t.album.id,
            name: t.album.name,
            artists: t.album.artists.map((a) => ({ providerId: a.id, name: a.name })),
            releaseDate: t.album.releaseDate,
          }
        : null,
    })),
  };
}

function appleTrack(t: AppleTrackData): ImportableTrack {
  return {
    providerId: t.id,
    name: t.name,
    artistDisplay: t.artistName,
    // One credit string, so at most one entity — and only when Apple gave us
    // an id for it. The string is never split.
    artists: t.artistId ? [{ providerId: t.artistId, name: t.artistName }] : [],
    durationMs: t.durationMs,
    isrc: null,
    trackNumber: t.trackNumber,
    album:
      t.albumId && t.albumName
        ? {
            providerId: t.albumId,
            name: t.albumName,
            artists: t.artistId ? [{ providerId: t.artistId, name: t.artistName }] : [],
            releaseDate: t.releaseDate,
          }
        : null,
  };
}

export function fromAppleCollection(
  data: AppleCollectionData,
  kind: "album" | "playlist",
): ImportableCollection {
  return {
    provider: Provider.apple_music,
    providerId: data.id,
    kind,
    name: data.name,
    description: null,
    sourceUrl:
      kind === "album"
        ? `https://music.apple.com/album/${data.id}`
        : `https://music.apple.com/playlist/${data.id}`,
    truncated: false,
    tracks: data.tracks.map(appleTrack),
  };
}
