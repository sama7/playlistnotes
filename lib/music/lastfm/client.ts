/**
 * Reading a public Last.fm listening history.
 *
 * ## What this is allowed to be
 *
 * A **source setting, not authentication** (AGENTS.md, Last.fm adapter). A
 * username here is the name of a public feed to read — exactly like typing in a
 * URL. It is never a login, it grants access to nothing, and nothing in the
 * product may depend on the person who typed it being the person who owns that
 * profile. `user.getrecenttracks` needs only an application API key, so no user
 * authorisation is involved on Last.fm's side either.
 *
 * ## Two rules from the contract that shape the code
 *
 *   - **Last.fm is never the canonical recording identity.** What it reports is
 *     returned as *what it said* — raw strings plus any MusicBrainz ids it chose
 *     to include — and it is the caller's job to decide what, if anything, that
 *     justifies creating. Nothing here resolves or merges an entity.
 *   - **Its artwork is not usable under the ordinary API terms.** The `image`
 *     array in every response is therefore never read. That is deliberate, and
 *     it is why a scrobble shows no cover until the recording is identified
 *     through a provider whose art we may show.
 *
 * The integration is feature-flagged by the presence of the API key, so an
 * unconfigured deployment simply never offers it.
 */

const API = "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT_MS = 8000;
/** A listening feed is text; anything this large is not one. */
const MAX_BYTES = 512 * 1024;

export class LastfmUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "not-configured" | "no-such-user" | "rate-limited" | "unavailable",
  ) {
    super(message);
    this.name = "LastfmUnavailableError";
  }
}

export function lastfmConfigured(): boolean {
  return Boolean(process.env.LASTFM_API_KEY);
}

/** One play as Last.fm reported it. Nothing here is resolved or trusted yet. */
export interface RecentTrack {
  trackName: string;
  artistName: string;
  albumName: string | null;
  /**
   * When it was played, or **null while it is still playing**. Null is not a
   * missing value to paper over: Last.fm genuinely cannot say when a play
   * happened until it finishes, and inventing a timestamp would corrupt the one
   * field this integration exists to preserve.
   */
  playedAt: Date | null;
  /** MusicBrainz ids, when Last.fm supplied them. Often absent; that is normal. */
  recordingMbid: string | null;
  artistMbid: string | null;
  albumMbid: string | null;
  url: string | null;
  /**
   * Stable per play, so re-reading the same window updates rather than
   * duplicating. Last.fm issues no scrobble id, so it is derived from the play
   * instant and the track — the pair that actually identifies a play.
   */
  sourceRef: string;
}

/** The subset of Last.fm's JSON this reads. `image` is absent on purpose. */
interface RawTrack {
  name?: string;
  mbid?: string;
  url?: string;
  artist?: { "#text"?: string; name?: string; mbid?: string };
  album?: { "#text"?: string; mbid?: string };
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
}

/** Last.fm answers 200 with an error body, so this is a normal path. */
interface RawResponse {
  error?: number;
  message?: string;
  recenttracks?: { track?: RawTrack | RawTrack[] };
}

function apiKey(): string {
  const key = process.env.LASTFM_API_KEY;
  if (!key) {
    throw new LastfmUnavailableError("Last.fm is not configured.", "not-configured");
  }
  return key;
}

/** An empty string is Last.fm's way of saying "no mbid", and is not an id. */
function mbid(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function call(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<RawResponse> {
  const url = new URL(API);
  // Built with URLSearchParams rather than string concatenation: a username is
  // user input and goes into a query string.
  for (const [k, v] of Object.entries({ ...params, api_key: apiKey(), format: "json" })) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "TrackJot (+https://trackjot.com)" },
    });
  } catch {
    // An abort and a network failure are the same thing to a caller: the feed
    // is not available right now, and nothing should be written.
    throw new LastfmUnavailableError("We couldn't reach Last.fm just now.", "unavailable");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new LastfmUnavailableError("Last.fm is rate-limiting us.", "rate-limited");
  }
  if (!response.ok) {
    throw new LastfmUnavailableError("Last.fm returned an error.", "unavailable");
  }

  const text = await response.text();
  if (text.length > MAX_BYTES) {
    throw new LastfmUnavailableError("Last.fm returned an implausibly large reply.", "unavailable");
  }

  let body: RawResponse;
  try {
    body = JSON.parse(text) as RawResponse;
  } catch {
    throw new LastfmUnavailableError("Last.fm returned something unreadable.", "unavailable");
  }

  // Last.fm reports failures with HTTP 200 and an error code in the body, so
  // checking the status alone would treat "no such user" as success.
  if (body.error) {
    // 6 is "Invalid parameters", which for these calls means the user does not
    // exist — worth distinguishing, because it is the one failure the person
    // typing can actually fix.
    if (body.error === 6) {
      throw new LastfmUnavailableError("Last.fm has no user by that name.", "no-such-user");
    }
    if (body.error === 29) {
      throw new LastfmUnavailableError("Last.fm is rate-limiting us.", "rate-limited");
    }
    throw new LastfmUnavailableError("Last.fm couldn't answer that.", "unavailable");
  }

  return body;
}

function toRecentTrack(raw: RawTrack): RecentTrack | null {
  const trackName = (raw.name ?? "").trim();
  const artistName = (raw.artist?.["#text"] ?? raw.artist?.name ?? "").trim();
  // A play with no track or artist is not a play we can show or write about.
  if (!trackName || !artistName) return null;

  const uts = raw.date?.uts ? Number(raw.date.uts) : null;
  const nowPlaying = raw["@attr"]?.nowplaying === "true";
  const playedAt = !nowPlaying && uts && Number.isFinite(uts) ? new Date(uts * 1000) : null;

  const albumName = (raw.album?.["#text"] ?? "").trim() || null;

  return {
    trackName,
    artistName,
    albumName,
    playedAt,
    recordingMbid: mbid(raw.mbid),
    artistMbid: mbid(raw.artist?.mbid),
    albumMbid: mbid(raw.album?.mbid),
    url: raw.url?.trim() || null,
    sourceRef: playedAt
      ? `${Math.floor(playedAt.getTime() / 1000)}:${artistName.toLowerCase()} - ${trackName.toLowerCase()}`
      : // Still playing, so there is no play to be idempotent about yet. The
        // caller does not persist these; a ref is supplied only so the UI has a
        // stable React key.
        `nowplaying:${artistName.toLowerCase()} - ${trackName.toLowerCase()}`,
  };
}

/**
 * The most recent plays on a public profile, newest first.
 *
 * `limit` is clamped: this feeds a strip on a page, and asking Last.fm for a
 * thousand rows because a query string said so is how an integration becomes a
 * denial-of-service lever against someone else's API.
 */
export async function fetchRecentTracks(
  username: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch,
): Promise<RecentTrack[]> {
  const body = await call(
    {
      method: "user.getrecenttracks",
      user: username,
      limit: String(Math.min(Math.max(limit, 1), 50)),
    },
    fetchImpl,
  );

  // Last.fm returns a bare object rather than an array when there is exactly
  // one result, which is the classic way a JSON API breaks a naive `.map`.
  const raw = body.recenttracks?.track;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return list.map(toRecentTrack).filter((t): t is RecentTrack => t !== null);
}

/**
 * Confirm a username exists before storing it.
 *
 * This checks that the *profile* is real, and deliberately not that the person
 * typing it owns the profile — the contract permits verifying ownership only if
 * the product claims the profile is verified, and it does not. Catching a typo
 * at the moment it is made is worth one request; claiming more than that would
 * not be.
 */
export async function lastfmUserExists(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    await call({ method: "user.getinfo", user: username }, fetchImpl);
    return true;
  } catch (error) {
    if (error instanceof LastfmUnavailableError && error.reason === "no-such-user") return false;
    throw error;
  }
}
