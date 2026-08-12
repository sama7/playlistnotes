import { parseSpotifyLink, type SpotifyRef } from "./parse-link";

/**
 * Resolving `spotify.link` short links.
 *
 * These appear when someone shares through a share sheet, a Spotify Code, or a
 * campaign link, rather than plain "Copy link" — uncommon, but a dead end if
 * unhandled.
 *
 * This is the only place TrackJot follows a redirect, so it is written as
 * a bounded walk rather than a fetch: **every hop's host must be on the
 * allowlist**, redirects are inspected manually instead of followed
 * automatically, hops are capped, and the whole thing is on a timeout.
 *
 * The danger being defended against is a short link that redirects somewhere
 * we would never have accepted had it been pasted directly — an internal
 * address, a metadata endpoint, a look-alike host. Checking only the first URL
 * would let the redirect chain smuggle the real target past us.
 */

/**
 * Hosts a short link is permitted to point at, at any hop.
 *
 * `spotify.app.link` is Spotify's Branch.io deep-link domain and a legitimate
 * intermediate hop — see the note below on why it is often the destination.
 */
const ALLOWED_HOPS = new Set([
  "spotify.link",
  "spoti.fi",
  "spotify.app.link",
  "open.spotify.com",
  "play.spotify.com",
]);

/**
 * Identify ourselves honestly, with a compatibility token.
 *
 * Verified 2026-08-10 against a live link: `spotify.link` is Branch.io powered
 * and routes on the user agent. Anything it reads as a possible mobile device
 * is handed to `spotify.app.link`, which answers 200 with an HTML interstitial
 * whose target is only recoverable by scraping. Branch keys on the token
 * `curl` appearing anywhere in the string, so declaring compatibility both
 * names us truthfully and gets the plain redirect.
 *
 * This is the oldest convention on the web — every browser claims to be
 * "Mozilla/5.0" — and it evades no access control: a public short link
 * resolving to a public track through the Location header is exactly what
 * redirects are for. We still never scrape the interstitial.
 */
const USER_AGENT = "TrackJot/2.0 curl-compatible (+https://trackjot.com)";

const MAX_HOPS = 4;
const TIMEOUT_MS = 4_000;

export type ShortLinkResolution =
  | { ok: true; ref: SpotifyRef }
  | { ok: false; reason: "not-a-short-link" | "unreachable" | "left-allowlist" | "too-many-hops" };

function hostAllowed(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOPS.has(url.hostname.toLowerCase());
}

export async function resolveSpotifyShortLink(
  input: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ShortLinkResolution> {
  const first = parseSpotifyLink(input);
  if (first.kind !== "short-link") return { ok: false, reason: "not-a-short-link" };

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  try {
    let current = new URL(first.url);

    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (!hostAllowed(current)) return { ok: false, reason: "left-allowlist" };

      const response = await doFetch(current.toString(), {
        method: "HEAD",
        headers: { "user-agent": USER_AGENT },
        // Inspected by us, never followed by the runtime — that is the whole
        // point of this function.
        redirect: "manual",
        signal: controller.signal,
      });

      const location = response.headers.get("location");

      if (!location) {
        // No further redirect: this is the destination.
        const ref = parseSpotifyLink(current.toString());
        return ref.kind === "short-link"
          ? { ok: false, reason: "unreachable" }
          : { ok: true, ref };
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, reason: "unreachable" };
      }

      if (!hostAllowed(next)) return { ok: false, reason: "left-allowlist" };

      // A canonical Spotify URL is the end of the walk — parse and stop rather
      // than making another request.
      const parsed = parseSpotifyLink(next.toString());
      if (parsed.kind !== "short-link" && parsed.kind !== "unsupported") {
        return { ok: true, ref: parsed };
      }

      current = next;
    }

    return { ok: false, reason: "too-many-hops" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
