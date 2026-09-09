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

import { createHash } from "node:crypto";

const API = "https://ws.audioscrobbler.com/2.0/";
/** Where a user is sent to approve access. Their host, over HTTPS. */
const AUTH_PAGE = "https://www.last.fm/api/auth/";
const TIMEOUT_MS = 8000;
/** A listening feed is text; anything this large is not one. */
const MAX_BYTES = 512 * 1024;

export class LastfmUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not-configured"
      | "no-such-user"
      | "rate-limited"
      | "unavailable"
      /** The profile hides its listening, so a public read cannot see it. */
      | "login-required"
      /** The stored session key was rejected — revoked, or no longer valid. */
      | "bad-session",
  ) {
    super(message);
    this.name = "LastfmUnavailableError";
  }
}

export function lastfmConfigured(): boolean {
  return Boolean(process.env.LASTFM_API_KEY);
}

/**
 * Whether the *authenticated* flow is available.
 *
 * Signing requires the shared secret as well as the key. Without it the
 * integration can still read public profiles, so this is a second, narrower
 * flag rather than a reason to hide the feature entirely.
 */
export function lastfmAuthConfigured(): boolean {
  return Boolean(process.env.LASTFM_API_KEY && process.env.LASTFM_SHARED_SECRET);
}

function sharedSecret(): string {
  const secret = process.env.LASTFM_SHARED_SECRET;
  if (!secret) {
    throw new LastfmUnavailableError("Last.fm sign-in is not configured.", "not-configured");
  }
  return secret;
}

/**
 * Last.fm's request signature.
 *
 * Every parameter except `format` and `callback`, sorted by name, concatenated
 * as name-then-value with no separators, then the shared secret, then MD5.
 * MD5 is not a choice — it is what their API specifies, and it is a signature
 * over a request rather than a password hash, so its collision weakness is not
 * the property being relied on.
 */
function sign(params: Record<string, string>): string {
  const payload = Object.keys(params)
    .filter((k) => k !== "format" && k !== "callback")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return createHash("md5").update(payload + sharedSecret(), "utf8").digest("hex");
}

/**
 * Where to send someone to approve access.
 *
 * The callback is passed per request rather than relying on the one configured
 * on the API account, so the same credentials serve localhost and production —
 * `APP_BASE_URL` is what differs between them.
 */
export function lastfmAuthUrl(callbackUrl: string): string {
  const url = new URL(AUTH_PAGE);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("cb", callbackUrl);
  return url.toString();
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
  options: { signed?: boolean } = {},
): Promise<RawResponse> {
  const url = new URL(API);
  const withKey = { ...params, api_key: apiKey() };
  // Signed BEFORE `format` is added, and `format` is excluded from the payload
  // anyway — Last.fm signs the request, not the response encoding.
  const finalParams = options.signed
    ? { ...withKey, api_sig: sign(withKey), format: "json" }
    : { ...withKey, format: "json" };

  // Built with URLSearchParams rather than string concatenation: a username is
  // user input and goes into a query string.
  for (const [k, v] of Object.entries(finalParams)) {
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

  /**
   * The body is read and parsed **whatever the status**, because Last.fm mixes
   * the two conventions: some failures come back as HTTP 200 with an error code
   * in the body, and others use a real status — 403 for a profile that hides its
   * listening, 404 for a name that does not exist. Checking `response.ok` first
   * threw all of those away as a generic "unavailable", which is how a hidden
   * profile looked like an outage instead of an invitation to sign in.
   */
  const text = await response.text();
  if (text.length > MAX_BYTES) {
    throw new LastfmUnavailableError("Last.fm returned an implausibly large reply.", "unavailable");
  }

  let body: RawResponse | null = null;
  try {
    body = JSON.parse(text) as RawResponse;
  } catch {
    body = null;
  }

  if (body?.error) {
    // 6 is "Invalid parameters", which for these calls means the user does not
    // exist — worth distinguishing, because it is the one failure the person
    // connecting can actually act on.
    if (body.error === 6) {
      throw new LastfmUnavailableError("Last.fm has no user by that name.", "no-such-user");
    }
    if (body.error === 29) {
      throw new LastfmUnavailableError("Last.fm is rate-limiting us.", "rate-limited");
    }
    // 17 is "user required to be logged in": the profile hides its listening
    // from the public API. This is the whole reason the approval flow exists,
    // and it is a normal state rather than a fault — a great many people turn
    // that setting on.
    if (body.error === 17) {
      throw new LastfmUnavailableError(
        "That profile hides its listening from the public API.",
        "login-required",
      );
    }
    // 9 is an invalid session key: revoked from Last.fm's own settings, or
    // expired. The user has to reconnect, and nothing else will fix it.
    if (body.error === 9) {
      throw new LastfmUnavailableError("The Last.fm connection needs renewing.", "bad-session");
    }
    throw new LastfmUnavailableError("Last.fm couldn't answer that.", "unavailable");
  }

  // No usable error code, so fall back to what the status says.
  if (response.status === 429) {
    throw new LastfmUnavailableError("Last.fm is rate-limiting us.", "rate-limited");
  }
  if (!response.ok || !body) {
    throw new LastfmUnavailableError("Last.fm returned something unreadable.", "unavailable");
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
  sessionKey?: string | null,
): Promise<RecentTrack[]> {
  /**
   * With a session key the request is signed and made *as* the connected
   * account, which is what lets it read a history the user has hidden from the
   * public API. Without one this is an ordinary public read, which still works
   * for the many profiles that do not hide anything.
   */
  const body = await call(
    {
      method: "user.getrecenttracks",
      user: username,
      limit: String(Math.min(Math.max(limit, 1), 50)),
      ...(sessionKey ? { sk: sessionKey } : {}),
    },
    fetchImpl,
    { signed: Boolean(sessionKey) },
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

/** What Last.fm returns once a user has approved access. */
export interface LastfmSession {
  /** The account name, as Last.fm reports it — never as the user typed it. */
  username: string;
  /** A credential. Never log, render, or export this. */
  sessionKey: string;
}

/**
 * Exchange a one-time token for a session key.
 *
 * The token arrives on our callback after the user approves on Last.fm's own
 * site; this is the step that proves the approval was real, because it is
 * signed with the shared secret that only this server holds.
 *
 * Session keys do not expire. They stop working when the user revokes access
 * from their Last.fm settings, which surfaces as `bad-session` on the next call.
 */
export async function exchangeToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LastfmSession> {
  const body = (await call(
    { method: "auth.getSession", token },
    fetchImpl,
    { signed: true },
  )) as RawResponse & { session?: { name?: string; key?: string } };

  const username = body.session?.name?.trim();
  const sessionKey = body.session?.key?.trim();

  if (!username || !sessionKey) {
    throw new LastfmUnavailableError("Last.fm did not complete the connection.", "unavailable");
  }
  return { username, sessionKey };
}
