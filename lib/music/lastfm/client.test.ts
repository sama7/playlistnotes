import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  LastfmUnavailableError,
  exchangeToken,
  fetchRecentTracks,
  lastfmAuthConfigured,
  lastfmAuthUrl,
  lastfmConfigured,
  lastfmUserExists,
} from "./client";

/**
 * The Last.fm adapter, against the shapes its API actually produces.
 *
 * Three of these are not hypothetical edge cases — they are the specific ways
 * this endpoint breaks naive parsers: it reports failure with HTTP 200, it
 * returns a bare object instead of an array when there is one result, and it
 * uses empty strings where a missing MusicBrainz id belongs.
 */

function json(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const PLAY = {
  name: "CN TOWER",
  mbid: "b1e2c3d4-0000-4000-8000-000000000001",
  url: "https://www.last.fm/music/PARTYNEXTDOOR/_/CN+TOWER",
  artist: { "#text": "PARTYNEXTDOOR", mbid: "a1a2a3a4-0000-4000-8000-000000000002" },
  album: { "#text": "$ome $exy $ongs 4 U", mbid: "" },
  date: { uts: "1756400000" },
};

beforeEach(() => {
  vi.stubEnv("LASTFM_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the feature flag", () => {
  it("is off when no API key is configured", () => {
    vi.stubEnv("LASTFM_API_KEY", "");
    expect(lastfmConfigured()).toBe(false);
  });

  it("refuses to call out with no key rather than sending a broken request", async () => {
    vi.stubEnv("LASTFM_API_KEY", "");
    const fetchImpl = vi.fn();

    await expect(fetchRecentTracks("samah-", 10, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      LastfmUnavailableError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reading recent plays", () => {
  it("maps a play, preserving the instant and the MusicBrainz ids", async () => {
    const [track] = await fetchRecentTracks(
      "samah-",
      10,
      json({ recenttracks: { track: [PLAY] } }),
    );

    expect(track!.trackName).toBe("CN TOWER");
    expect(track!.artistName).toBe("PARTYNEXTDOOR");
    expect(track!.albumName).toBe("$ome $exy $ongs 4 U");
    expect(track!.playedAt?.toISOString()).toBe(new Date(1756400000 * 1000).toISOString());
    expect(track!.recordingMbid).toBe("b1e2c3d4-0000-4000-8000-000000000001");
    expect(track!.artistMbid).toBe("a1a2a3a4-0000-4000-8000-000000000002");
  });

  /** Last.fm writes "" for an unknown mbid. An empty string is not an id. */
  it("treats an empty mbid as absent rather than as an identifier", async () => {
    const [track] = await fetchRecentTracks("samah-", 10, json({ recenttracks: { track: [PLAY] } }));
    expect(track!.albumMbid).toBeNull();
  });

  /** The classic shape break: one result comes back unwrapped. */
  it("handles a single play returned as an object rather than an array", async () => {
    const tracks = await fetchRecentTracks("samah-", 10, json({ recenttracks: { track: PLAY } }));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.trackName).toBe("CN TOWER");
  });

  it("returns nothing for a profile with no plays", async () => {
    expect(await fetchRecentTracks("samah-", 10, json({ recenttracks: {} }))).toEqual([]);
  });

  /**
   * A track still playing has no timestamp, and inventing one would corrupt the
   * single field this integration exists to preserve.
   */
  it("reports a now-playing track with a null instant", async () => {
    const nowPlaying = { ...PLAY, date: undefined, "@attr": { nowplaying: "true" } };
    const [track] = await fetchRecentTracks(
      "samah-",
      10,
      json({ recenttracks: { track: [nowPlaying] } }),
    );

    expect(track!.playedAt).toBeNull();
    expect(track!.sourceRef).toMatch(/^nowplaying:/);
  });

  it("gives each play a ref that is stable across re-reads", async () => {
    const first = await fetchRecentTracks("samah-", 10, json({ recenttracks: { track: [PLAY] } }));
    const again = await fetchRecentTracks("samah-", 10, json({ recenttracks: { track: [PLAY] } }));
    expect(first[0]!.sourceRef).toBe(again[0]!.sourceRef);
    expect(first[0]!.sourceRef).toContain("1756400000");
  });

  it("drops a row with no track or artist rather than inventing placeholders", async () => {
    const tracks = await fetchRecentTracks(
      "samah-",
      10,
      json({ recenttracks: { track: [{ name: "", artist: { "#text": "" } }, PLAY] } }),
    );
    expect(tracks).toHaveLength(1);
  });

  /** Asking for a thousand rows because a query string said so is not on. */
  it("clamps the requested limit", async () => {
    const fetchImpl = vi.fn(
      async (url: URL) => {
        expect(url.searchParams.get("limit")).toBe("50");
        return new Response(JSON.stringify({ recenttracks: { track: [] } }));
      },
    );
    await fetchRecentTracks("samah-", 5000, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalled();
  });

  /** Last.fm never sends artwork we may use, so it is never read. */
  it("ignores the image array entirely", async () => {
    const withImages = {
      ...PLAY,
      image: [{ "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/x.png", size: "large" }],
    };
    const [track] = await fetchRecentTracks(
      "samah-",
      10,
      json({ recenttracks: { track: [withImages] } }),
    );
    expect(JSON.stringify(track)).not.toContain("lastfm.freetls");
  });
});

/**
 * Last.fm mixes conventions: some failures are HTTP 200 with an error code in
 * the body, others use a real status — 403 for a hidden profile, 404 for a name
 * that does not exist. Both shapes are verified here, because reading only the
 * status made a hidden profile look like an outage.
 */
describe("failures, however Last.fm chooses to report them", () => {
  it("reads the error code out of a 403, not just the status", async () => {
    await expect(
      fetchRecentTracks(
        "womenaresmarter",
        10,
        json({ error: 17, message: "Login: User required to be logged in" }, 403),
      ),
    ).rejects.toMatchObject({ reason: "login-required" });
  });

  it("reads the error code out of a 404", async () => {
    await expect(
      fetchRecentTracks("nobody", 10, json({ error: 6, message: "User not found" }, 404)),
    ).rejects.toMatchObject({ reason: "no-such-user" });
  });

  it("distinguishes an unknown username, which the user can fix", async () => {
    await expect(
      fetchRecentTracks("nobody", 10, json({ error: 6, message: "User not found" })),
    ).rejects.toMatchObject({ reason: "no-such-user" });
  });

  it("reports a missing user as absent rather than throwing, when only checking", async () => {
    expect(await lastfmUserExists("nobody", json({ error: 6 }))).toBe(false);
    expect(await lastfmUserExists("samah-", json({ user: { name: "samah-" } }))).toBe(true);
  });

  it("surfaces rate limiting as its own reason", async () => {
    await expect(
      fetchRecentTracks("samah-", 10, json({ error: 29, message: "Rate limit exceeded" })),
    ).rejects.toMatchObject({ reason: "rate-limited" });
    await expect(
      fetchRecentTracks("samah-", 10, json({}, 429)),
    ).rejects.toMatchObject({ reason: "rate-limited" });
  });

  it("does not mistake unreadable output for an empty history", async () => {
    const notJson = (async () => new Response("<html>down</html>")) as unknown as typeof fetch;
    await expect(fetchRecentTracks("samah-", 10, notJson)).rejects.toThrow(LastfmUnavailableError);
  });

  it("turns a network failure into an unavailable feed, not a crash", async () => {
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(fetchRecentTracks("samah-", 10, boom)).rejects.toMatchObject({
      reason: "unavailable",
    });
  });
});

/**
 * The authenticated half: signing, the token exchange, and the two failures
 * that make it necessary.
 */
describe("authenticating to Last.fm", () => {
  beforeEach(() => {
    vi.stubEnv("LASTFM_SHARED_SECRET", "s3cr3t");
  });

  it("is unavailable until the shared secret is present, not just the key", () => {
    expect(lastfmAuthConfigured()).toBe(true);
    vi.stubEnv("LASTFM_SHARED_SECRET", "");
    expect(lastfmAuthConfigured()).toBe(false);
    // The public half still works without it.
    expect(lastfmConfigured()).toBe(true);
  });

  it("sends the user to Last.fm with the callback it should return to", () => {
    const url = new URL(lastfmAuthUrl("https://trackjot.com/api/lastfm/callback?state=abc"));
    expect(url.origin + url.pathname).toBe("https://www.last.fm/api/auth/");
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(url.searchParams.get("cb")).toBe(
      "https://trackjot.com/api/lastfm/callback?state=abc",
    );
    // The secret is never part of a URL the user's browser will follow.
    expect(url.toString()).not.toContain("s3cr3t");
  });

  /**
   * Their documented scheme: every parameter except `format` and `callback`,
   * sorted by name, concatenated name-then-value, then the shared secret, then
   * MD5. Computed independently here rather than by calling the same helper,
   * so this checks the scheme and not merely that the code agrees with itself.
   */
  it("signs the token exchange exactly as Last.fm specifies", async () => {
    let seen: URL | null = null;
    const fetchImpl = (async (url: URL) => {
      seen = url;
      return new Response(JSON.stringify({ session: { name: "samah-", key: "sk-123" } }));
    }) as unknown as typeof fetch;

    await exchangeToken("one-time-token", fetchImpl);

    const expected = createHash("md5")
      .update(
        "api_key" + "test-key" + "method" + "auth.getSession" + "token" + "one-time-token" + "s3cr3t",
        "utf8",
      )
      .digest("hex");
    expect(seen!.searchParams.get("api_sig")).toBe(expected);
    // `format` is excluded from the payload but still sent.
    expect(seen!.searchParams.get("format")).toBe("json");
  });

  it("returns the account name Last.fm reports, not one supplied to it", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ session: { name: "womenaresmarter", key: "sk-abc" } }),
      )) as unknown as typeof fetch;

    expect(await exchangeToken("t", fetchImpl)).toEqual({
      username: "womenaresmarter",
      sessionKey: "sk-abc",
    });
  });

  it("refuses an exchange that comes back without a session", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({}))) as unknown as typeof fetch;
    await expect(exchangeToken("t", fetchImpl)).rejects.toThrow(LastfmUnavailableError);
  });

  /** The failure that motivated the whole flow — a hidden listening history. */
  it("names a hidden profile as needing sign-in, not as broken", async () => {
    await expect(
      fetchRecentTracks("womenaresmarter", 10, json({ error: 17, message: "Login: ..." })),
    ).rejects.toMatchObject({ reason: "login-required" });
  });

  it("names a revoked session key as its own failure", async () => {
    await expect(
      fetchRecentTracks("samah-", 10, json({ error: 9, message: "Invalid session key" })),
    ).rejects.toMatchObject({ reason: "bad-session" });
  });

  it("signs a recent-tracks read when given a session key, and not otherwise", async () => {
    let seen: URL | null = null;
    const capture = (async (url: URL) => {
      seen = url;
      return new Response(JSON.stringify({ recenttracks: { track: [] } }));
    }) as unknown as typeof fetch;

    await fetchRecentTracks("samah-", 10, capture, "sk-123");
    expect(seen!.searchParams.get("sk")).toBe("sk-123");
    expect(seen!.searchParams.get("api_sig")).toMatch(/^[0-9a-f]{32}$/);

    await fetchRecentTracks("samah-", 10, capture);
    expect(seen!.searchParams.get("sk")).toBeNull();
    expect(seen!.searchParams.get("api_sig")).toBeNull();
  });

  /** A credential must not travel in anything a user or a log could see. */
  it("never puts the shared secret in the request URL", async () => {
    let seen: URL | null = null;
    const capture = (async (url: URL) => {
      seen = url;
      return new Response(JSON.stringify({ recenttracks: { track: [] } }));
    }) as unknown as typeof fetch;

    await fetchRecentTracks("samah-", 10, capture, "sk-123");
    expect(seen!.toString()).not.toContain("s3cr3t");
  });
});
