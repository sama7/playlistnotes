import { canonicalUrlFor, type SpotifyEntity } from "./parse-link";

/**
 * Spotify's oEmbed endpoint — the only Spotify network call v2 makes.
 *
 * It needs no Client ID, no secret, and no user authorisation, which is what
 * makes the whole provider-independent premise work. It is also *presentation*
 * metadata, not a data API: it may change, rate-limit, or disappear.
 *
 * Therefore the contract here is: **best effort, never load-bearing.** Every
 * failure path returns `null` rather than throwing, and the caller creates the
 * note regardless. AGENTS.md §8: note creation must not block on metadata.
 *
 * Observed limitation, confirmed 2026-08-08: oEmbed returns a `title` string
 * with **no separate artist field** — "Darling, I (feat. Teezo Touchdown)" came
 * back with no mention of Tyler, The Creator. That is precisely why the capture
 * form keeps title and artist editable rather than treating this as truth.
 */

const OEMBED_ENDPOINT = "https://open.spotify.com/oembed";

/** Slow enough to succeed on a bad day, fast enough not to strand a user. */
const TIMEOUT_MS = 4_000;

/** oEmbed responses are ~1 KB. Anything approaching this is not a response. */
const MAX_BYTES = 64 * 1024;

/** Thumbnail hosts we will store a URL for. Never rehosted, only linked. */
const ALLOWED_IMAGE_HOSTS = new Set(["i.scdn.co", "image-cdn-ak.spotifycdn.com", "mosaic.scdn.co"]);

export interface SpotifyOEmbed {
  /** Provider title. May bundle "(feat. …)" and never names the artist alone. */
  title: string | null;
  thumbnailUrl: string | null;
  /** When we fetched it, so staleness is visible downstream. */
  retrievedAt: string;
}

function safeThumbnail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch display metadata for an already-parsed Spotify entity.
 *
 * Takes a kind and an id rather than a URL — deliberately. There is no code
 * path here that fetches a user-supplied address; the URL is reconstructed from
 * values that `parseSpotifyLink` has already validated, so this cannot be
 * pointed at an arbitrary host.
 */
export async function fetchSpotifyOEmbed(
  kind: SpotifyEntity,
  id: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SpotifyOEmbed | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  try {
    const target = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonicalUrlFor(kind, id))}`;
    const response = await doFetch(target, {
      signal: controller.signal,
      // A redirect away from Spotify is not something we follow.
      redirect: "error",
      headers: { accept: "application/json" },
    });

    if (!response.ok) return null;

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return null;

    const body = await response.text();
    if (body.length > MAX_BYTES) return null;

    const parsed: unknown = JSON.parse(body);
    // `typeof [] === "object"`, so arrays need excluding explicitly or a JSON
    // array would pass this guard and produce a hollow all-null result.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title.slice(0, 500) : null,
      thumbnailUrl: safeThumbnail(record.thumbnail_url),
      retrievedAt: new Date().toISOString(),
    };
  } catch {
    // Timeout, abort, network failure, malformed JSON — all the same to us.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
