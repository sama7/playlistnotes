import { Provider } from "@prisma/client";
import { parseSpotifyLink } from "@/lib/music/spotify/parse-link";
import { fetchSpotifyOEmbed } from "@/lib/music/spotify/oembed";
import {
  createUserAuthoredRecording,
  findByProviderId,
  resolveByProviderId,
  type ResolutionResult,
} from "@/lib/music/resolve-recording";

/**
 * Turning something a user pasted into a recording they can write about.
 *
 * The core independence invariant (AGENTS.md §1) lives here: this path uses no
 * Client ID, no secret, no access token, and no OAuth callback. The only
 * network call is unauthenticated oEmbed, and it is allowed to fail.
 */

export type CaptureOutcome =
  | {
      ok: true;
      result: ResolutionResult;
      metadataAvailable: boolean;
      /** Where the metadata came from. "database" means no provider was contacted. */
      source: "database" | "provider" | "manual";
    }
  | {
      ok: false;
      reason: CaptureRefusal;
      message: string;
      /** What we did manage to learn, so the form can prefill rather than
       *  making the user retype it. */
      suggested?: { title?: string | null };
    };

export type CaptureRefusal =
  | "playlist"
  | "album-or-artist"
  | "short-link"
  | "unsupported"
  | "needs-manual-metadata";

/**
 * A pasted playlist link is refused with an explanation, never an error.
 *
 * Playlistnotes genuinely cannot read a playlist's tracks without OAuth, and
 * pretending otherwise — by creating an empty collection — would be worse than
 * saying so. §4.4: a playlist link creates no collection and no items.
 */
const PLAYLIST_MESSAGE =
  "That's a playlist. Playlistnotes can't read a playlist's tracks from Spotify. " +
  "You can import them from a CSV, or start a collection and add tracks by link.";

export async function captureFromSpotifyLink(
  input: string,
  options: {
    /** Supplied by the user when metadata is unavailable — never authoritative
     *  over an existing shared recording. */
    fallback?: { title: string; artistDisplay: string };
    fetchOEmbed?: typeof fetchSpotifyOEmbed;
  } = {},
): Promise<CaptureOutcome> {
  const ref = parseSpotifyLink(input);

  switch (ref.kind) {
    case "playlist":
      return { ok: false, reason: "playlist", message: PLAYLIST_MESSAGE };

    case "album":
    case "artist":
      return {
        ok: false,
        reason: "album-or-artist",
        message: `Playlistnotes captures individual tracks for now, not ${ref.kind}s.`,
      };

    case "short-link":
      return {
        ok: false,
        reason: "short-link",
        message:
          "Short Spotify links aren't supported yet — open it in Spotify and copy the full track link.",
      };

    case "unsupported":
      return {
        ok: false,
        reason: "unsupported",
        message: "That doesn't look like a Spotify track link.",
      };

    case "track":
      break;
  }

  /**
   * DATABASE FIRST. This ordering is the rate-limit guarantee, and it is load
   * bearing: a track we have already seen resolves with **zero network calls**,
   * however many people paste it. Provider requests are therefore proportional
   * to how fast the catalog grows, not to how much the product is used — a far
   * flatter curve, and the reason a shared Development Mode quota is survivable.
   *
   * `no-network-on-known-track.test.ts` asserts the call count directly, so
   * reintroducing a lookup above this line fails the suite rather than quietly
   * costing us quota.
   */
  const known = await findByProviderId(Provider.spotify, ref.id);
  if (known) {
    return {
      ok: true,
      result: { recording: known, strategy: "provider-id", decision: "matched" },
      metadataAvailable: true,
      source: "database",
    };
  }

  const oembed = await (options.fetchOEmbed ?? fetchSpotifyOEmbed)("track", ref.id);

  /**
   * Verified against the live endpoint 2026-08-09: a track oEmbed response
   * contains html, iframe_url, width, height, version, provider_name,
   * provider_url, type, title, thumbnail_url and thumbnail dimensions — and
   * **no artist field of any kind**.
   *
   * So oEmbed can supply the title and never the artist. The first paste is
   * therefore expected to come back asking for one; that is a prompt, not a
   * failure, and the title is handed back so the user fills one field rather
   * than two. We never invent an artist, because canonical metadata is
   * write-once and a guess here would become everyone's guess.
   */
  const title = options.fallback?.title?.trim() || oembed?.title?.trim() || "";
  const artistDisplay = options.fallback?.artistDisplay?.trim() || "";

  if (!title || !artistDisplay) {
    return {
      ok: false,
      reason: "needs-manual-metadata",
      message: title
        ? `Found “${title}”. Spotify's public preview doesn't include the artist — add it and we'll save this.`
        : "We couldn't fetch this track's details. Add the title and artist and we'll save it.",
      suggested: { title: title || null },
    };
  }

  const result = await resolveByProviderId({
    provider: Provider.spotify,
    providerId: ref.id,
    providerUrl: ref.canonicalUrl,
    title,
    artistDisplay,
  });

  return {
    ok: true,
    result,
    metadataAvailable: oembed !== null,
    source: oembed !== null ? "provider" : "manual",
  };
}

export { createUserAuthoredRecording };
