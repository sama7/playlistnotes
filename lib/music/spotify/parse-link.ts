/**
 * Parsing Spotify links without OAuth.
 *
 * This is the front door of the capture flow, so it is also the security
 * boundary. Everything downstream trusts that a `SpotifyRef` came from here.
 *
 * Two jobs:
 *
 *   1. Recognise what a user pasted — track, playlist, album, artist — so the
 *      product can respond honestly. A playlist link must be *recognised* in
 *      order to be refused: AGENTS.md §4.4 requires that it never create a
 *      collection or an item, and you cannot enforce that without identifying
 *      it first.
 *   2. Refuse anything that is not an official Spotify address, before any
 *      network call is even considered. No user-supplied URL is ever fetched
 *      generically.
 */

/** Spotify IDs are base62 and 22 characters. Anchored — no partial matches. */
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/** Hosts we will parse. Anything else is refused, including look-alikes. */
const CANONICAL_HOSTS = new Set(["open.spotify.com", "play.spotify.com"]);

/**
 * Short-link hosts. These resolve to a canonical URL through a bounded,
 * allowlisted redirect chain — never a generic fetch.
 */
const SHORT_LINK_HOSTS = new Set(["spotify.link", "spoti.fi"]);

export type SpotifyEntity = "track" | "playlist" | "album" | "artist";

export type SpotifyRef =
  | { kind: SpotifyEntity; id: string; canonicalUrl: string }
  | { kind: "short-link"; url: string }
  | { kind: "unsupported"; reason: UnsupportedReason };

export type UnsupportedReason =
  | "empty"
  | "not-a-url"
  | "wrong-scheme"
  | "wrong-host"
  | "unknown-path"
  | "malformed-id"
  | "unsupported-entity";

/**
 * Locale-prefixed paths are real: Spotify serves `/intl-pt/track/{id}` and
 * users paste them. Strip a leading `intl-xx` segment before matching.
 */
function stripLocale(segments: string[]): string[] {
  const [first] = segments;
  return first && /^intl-[a-z]{2}(-[a-z]{2})?$/i.test(first) ? segments.slice(1) : segments;
}

function isEntity(value: string): value is SpotifyEntity {
  return value === "track" || value === "playlist" || value === "album" || value === "artist";
}

/** `https://open.spotify.com/track/{id}` — no tracking parameters, no locale. */
export function canonicalUrlFor(kind: SpotifyEntity, id: string): string {
  return `https://open.spotify.com/${kind}/${id}`;
}

/**
 * Parse a pasted Spotify reference.
 *
 * Accepts the `spotify:track:{id}` URI form and official HTTPS URLs. Query
 * parameters — Spotify's `si` share token among them — are discarded rather
 * than stored: they identify the sharer, and we have no use for them.
 */
export function parseSpotifyLink(input: string): SpotifyRef {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "unsupported", reason: "empty" };

  // URI form: spotify:track:4u43I0LP2Xf85OAS85eG0R
  if (/^spotify:/i.test(trimmed)) {
    const parts = trimmed.split(":");
    const kind = parts[1]?.toLowerCase();
    const id = parts[2];
    if (!kind || !id) return { kind: "unsupported", reason: "unknown-path" };
    if (!isEntity(kind)) return { kind: "unsupported", reason: "unsupported-entity" };
    if (!SPOTIFY_ID.test(id)) return { kind: "unsupported", reason: "malformed-id" };
    return { kind, id, canonicalUrl: canonicalUrlFor(kind, id) };
  }

  let url: URL;
  try {
    // Tolerate a pasted "open.spotify.com/track/..." with no scheme.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { kind: "unsupported", reason: "not-a-url" };
  }

  // http is upgraded by the allowlist below; anything else — javascript:,
  // data:, file: — is refused outright.
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "unsupported", reason: "wrong-scheme" };
  }

  const host = url.hostname.toLowerCase();

  if (SHORT_LINK_HOSTS.has(host)) {
    // Resolution is a separate, deliberately bounded step.
    return { kind: "short-link", url: `https://${host}${url.pathname}` };
  }

  if (!CANONICAL_HOSTS.has(host)) {
    return { kind: "unsupported", reason: "wrong-host" };
  }

  const segments = stripLocale(url.pathname.split("/").filter(Boolean));
  const [entity, id] = segments;

  if (!entity || !id) return { kind: "unsupported", reason: "unknown-path" };
  if (!isEntity(entity.toLowerCase())) return { kind: "unsupported", reason: "unsupported-entity" };
  if (!SPOTIFY_ID.test(id)) return { kind: "unsupported", reason: "malformed-id" };

  const kind = entity.toLowerCase() as SpotifyEntity;
  return { kind, id, canonicalUrl: canonicalUrlFor(kind, id) };
}

/** Convenience for the note flow, which only ever accepts tracks. */
export function parseSpotifyTrack(
  input: string,
): { ok: true; id: string; canonicalUrl: string } | { ok: false; ref: SpotifyRef } {
  const ref = parseSpotifyLink(input);
  return ref.kind === "track"
    ? { ok: true, id: ref.id, canonicalUrl: ref.canonicalUrl }
    : { ok: false, ref };
}
