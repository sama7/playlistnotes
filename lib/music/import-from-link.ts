import { parseSpotifyLink } from "@/lib/music/spotify/parse-link";
import { resolveSpotifyShortLink } from "@/lib/music/spotify/resolve-short-link";
import {
  SpotifyUnavailableError,
  fetchAlbum,
  fetchPlaylist,
  spotifyConfigured,
} from "@/lib/music/spotify/web-api";
import { importCollection, type ImportSummary } from "@/lib/music/import-collection";
import { fromSpotifyCollection } from "@/lib/music/importable";

/**
 * Pasting an album or public playlist link and getting a collection.
 *
 * This is what makes the product's name true again: v1's actual value was
 * annotating the tracks in a playlist, and it needed a Spotify login to do it.
 * Client Credentials authenticates the *application*, so the same capability
 * arrives with no user OAuth and no five-user cap.
 *
 * The two cases that genuinely cannot work are detected and explained rather
 * than failing vaguely — CSV import remains the honest fallback for both.
 */

export type ImportOutcome =
  | { ok: true; summary: ImportSummary }
  | { ok: false; reason: ImportRefusal; message: string };

export type ImportRefusal =
  | "not-a-collection"
  | "editorial-or-private"
  | "not-configured"
  | "rate-limited"
  | "unavailable"
  | "empty";

const CSV_SUGGESTION =
  "You can still bring it in with a CSV export, or start a collection and add tracks by link.";

export async function importFromSpotifyLink(
  ownerId: string,
  input: string,
  options: {
    fetchAlbumImpl?: typeof fetchAlbum;
    fetchPlaylistImpl?: typeof fetchPlaylist;
    resolveShortLinkImpl?: typeof resolveSpotifyShortLink;
  } = {},
): Promise<ImportOutcome> {
  let ref = parseSpotifyLink(input);

  if (ref.kind === "short-link") {
    const resolved = await (options.resolveShortLinkImpl ?? resolveSpotifyShortLink)(input);
    if (!resolved.ok) {
      return {
        ok: false,
        reason: "not-a-collection",
        message: "We couldn't follow that short link. Open it in Spotify and copy the full link.",
      };
    }
    ref = resolved.ref;
  }

  if (ref.kind !== "album" && ref.kind !== "playlist") {
    return {
      ok: false,
      reason: "not-a-collection",
      message: "That isn't an album or playlist link.",
    };
  }

  if (!spotifyConfigured()) {
    return {
      ok: false,
      reason: "not-configured",
      message: `Importing whole collections isn't available right now. ${CSV_SUGGESTION}`,
    };
  }

  try {
    const data =
      ref.kind === "album"
        ? await (options.fetchAlbumImpl ?? fetchAlbum)(ref.id)
        : await (options.fetchPlaylistImpl ?? fetchPlaylist)(ref.id);

    if (data.tracks.length === 0) {
      return {
        ok: false,
        reason: "empty",
        message: "That collection came back empty, so there was nothing to import.",
      };
    }

    const summary = await importCollection(ownerId, fromSpotifyCollection(data));
    return { ok: true, summary };
  } catch (error) {
    if (!(error instanceof SpotifyUnavailableError)) throw error;

    switch (error.reason) {
      case "not-found":
        /**
         * A 404 here means one of exactly two things, and the user deserves to
         * know which situation they are in rather than being told "not found":
         * Spotify withdrew its own editorial playlists from Development Mode
         * apps, and private playlists genuinely require the owner's
         * authorisation. Neither is something we can work around.
         */
        return {
          ok: false,
          reason: "editorial-or-private",
          message:
            ref.kind === "playlist"
              ? `Spotify won't share that playlist's tracks — it's either one of Spotify's own editorial playlists or a private one. ${CSV_SUGGESTION}`
              : `Spotify doesn't have that album available. ${CSV_SUGGESTION}`,
        };
      case "rate-limited":
        return {
          ok: false,
          reason: "rate-limited",
          message: "Spotify is rate limiting us at the moment. Try again in a minute.",
        };
      default:
        return {
          ok: false,
          reason: "unavailable",
          message: `We couldn't reach Spotify just now. ${CSV_SUGGESTION}`,
        };
    }
  }
}
