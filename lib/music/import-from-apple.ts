import { Provider } from "@prisma/client";
import { parseAppleMusicLink } from "@/lib/music/apple/parse-link";
import { fetchAppleAlbum } from "@/lib/music/apple/itunes";
import { fetchAppleAlbumCatalog, fetchApplePlaylistCatalog } from "@/lib/music/apple/catalog";
import { appleMusicConfigured } from "@/lib/music/apple/developer-token";
import { AppleMusicUnavailableError } from "@/lib/music/apple/music-api";
import { importCollection, type ImportSummary } from "@/lib/music/import-collection";
import { fromAppleCollection, type ImportableCollection } from "@/lib/music/importable";

/**
 * Pasting an Apple Music album or playlist link and getting a collection.
 *
 * Apple exposes two catalogues with very different entry requirements, and the
 * split matters enough to be explicit about:
 *
 *   - **Albums** work through the public iTunes lookup with **no account at
 *     all**. The cost is fidelity: iTunes flattens a collaboration into one
 *     credit string and one artist id, so a joint album links one artist per
 *     track instead of every artist.
 *   - **Playlists** exist only in the catalog API, which requires a signed
 *     developer token — an Apple Developer Program membership. There is no
 *     public fallback, so without the token this refuses and explains why
 *     rather than failing vaguely.
 *
 * When a developer token *is* configured, albums are read from the catalog API
 * too, because `include=artists` returns the real artist relationships and
 * recovers the fidelity iTunes drops.
 */

export type AppleImportOutcome =
  | { ok: true; summary: ImportSummary }
  | { ok: false; reason: AppleImportRefusal; message: string };

export type AppleImportRefusal =
  | "not-a-collection"
  | "needs-developer-token"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "empty";

const CSV_SUGGESTION =
  "You can still bring it in with a CSV export, or start a collection and add tracks by link.";

export async function importFromAppleLink(
  ownerId: string,
  input: string,
  options: {
    fetchAlbumImpl?: typeof fetchAppleAlbum;
    fetchAlbumCatalogImpl?: typeof fetchAppleAlbumCatalog;
    fetchPlaylistCatalogImpl?: typeof fetchApplePlaylistCatalog;
    configured?: () => boolean;
  } = {},
): Promise<AppleImportOutcome> {
  const ref = parseAppleMusicLink(input);
  const hasToken = (options.configured ?? appleMusicConfigured)();

  if (ref.kind !== "album" && ref.kind !== "playlist") {
    return {
      ok: false,
      reason: "not-a-collection",
      message: "That isn't an Apple Music album or playlist link.",
    };
  }

  if (ref.kind === "playlist" && !hasToken) {
    return {
      ok: false,
      reason: "needs-developer-token",
      message: `Apple Music playlists need a developer key that isn't set up yet. ${CSV_SUGGESTION}`,
    };
  }

  try {
    const data = await load(ref.kind, ref.id, hasToken, options);
    if (!data) {
      return {
        ok: false,
        reason: "not-found",
        message: `Apple Music doesn't have that ${ref.kind} available. ${CSV_SUGGESTION}`,
      };
    }
    if (data.tracks.length === 0) {
      return {
        ok: false,
        reason: "empty",
        message: "That collection came back empty, so there was nothing to import.",
      };
    }

    return { ok: true, summary: await importCollection(ownerId, data) };
  } catch (error) {
    if (!(error instanceof AppleMusicUnavailableError)) throw error;

    switch (error.reason) {
      case "not-found":
        return {
          ok: false,
          reason: "not-found",
          message: `Apple Music doesn't have that ${ref.kind} available. ${CSV_SUGGESTION}`,
        };
      case "rate-limited":
        return {
          ok: false,
          reason: "rate-limited",
          message: "Apple Music is rate limiting us at the moment. Try again in a minute.",
        };
      case "not-configured":
        return {
          ok: false,
          reason: "needs-developer-token",
          message: `Apple Music isn't fully set up yet. ${CSV_SUGGESTION}`,
        };
      default:
        return {
          ok: false,
          reason: "unavailable",
          message: `We couldn't reach Apple Music just now. ${CSV_SUGGESTION}`,
        };
    }
  }
}

async function load(
  kind: "album" | "playlist",
  id: string,
  hasToken: boolean,
  options: Parameters<typeof importFromAppleLink>[2] = {},
): Promise<ImportableCollection | null> {
  if (kind === "playlist") {
    return (options.fetchPlaylistCatalogImpl ?? fetchApplePlaylistCatalog)(id);
  }
  if (hasToken) {
    return (options.fetchAlbumCatalogImpl ?? fetchAppleAlbumCatalog)(id);
  }
  const album = await (options.fetchAlbumImpl ?? fetchAppleAlbum)(id);
  return album ? fromAppleCollection(album, "album") : null;
}

/** Which provider a pasted collection link belongs to, or null if neither. */
export function collectionProvider(input: string): Provider | null {
  const apple = parseAppleMusicLink(input);
  if (apple.kind === "album" || apple.kind === "playlist") return Provider.apple_music;
  return null;
}
