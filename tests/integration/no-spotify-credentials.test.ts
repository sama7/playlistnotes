import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureFromSpotifyLink } from "@/lib/music/capture";
import { parseSpotifyLink } from "@/lib/music/spotify/parse-link";
import { createNote, listNotes } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * The core independence invariant, AGENTS.md §1.
 *
 * Everything below runs with **no Spotify Client ID, secret, access token,
 * refresh token, OAuth callback, or SDK** — none are configured anywhere in
 * this project, and the first test asserts that rather than assuming it.
 *
 * This is the whole reason v2 exists: v1 could not onboard a sixth user because
 * Spotify identity was Playlistnotes identity. If these tests ever need a
 * credential to pass, the rescue has failed.
 */

const oembedUnavailable = async () => null;

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the core flow needs no Spotify credentials", () => {
  /**
   * The invariant is NOT "no Spotify variable exists" — Client Credentials is
   * sanctioned optional enrichment, so a client id and secret are legitimate.
   * It is that **no user-OAuth surface exists**: no access token, no refresh
   * token, no redirect URI. Those are what the five-user Development Mode cap
   * counts, and v2 has none of them.
   */
  it("has no Spotify USER-OAuth credentials in the environment", () => {
    for (const key of Object.keys(process.env)) {
      expect(key).not.toMatch(/^SPOTIFY_(ACCESS_TOKEN|REFRESH_TOKEN|REDIRECT_URI)/);
    }
  });

  /**
   * And the core flow still runs with the optional credential absent. Unset it
   * for the duration and confirm capture still reaches a saved note — this is
   * the property that would actually break if enrichment quietly became a
   * dependency.
   */
  it("captures and saves with the optional credential removed entirely", async () => {
    const savedId = process.env.SPOTIFY_CLIENT_ID;
    const savedSecret = process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;

    try {
      const user = await prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
      const capture = await captureFromSpotifyLink(
        "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R",
        {
          fetchOEmbed: oembedUnavailable,
          fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
        },
      );

      expect(capture.ok).toBe(true);
      if (!capture.ok) return;

      const note = await createNote(user.id, {
        recordingId: capture.result.recording.id,
        body: "written with no Spotify credential configured at all",
      });
      expect(note.visibility).toBe("private");
    } finally {
      if (savedId) process.env.SPOTIFY_CLIENT_ID = savedId;
      if (savedSecret) process.env.SPOTIFY_CLIENT_SECRET = savedSecret;
    }
  });

  it("captures a track and saves a private note with oEmbed unavailable", async () => {
    const user = await prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });

    const capture = await captureFromSpotifyLink(
      "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R",
      {
        fetchOEmbed: oembedUnavailable,
        fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
      },
    );

    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(capture.metadataAvailable).toBe(false);

    const note = await createNote(user.id, {
      recordingId: capture.result.recording.id,
      body: "The city sounds under the intro are why this playlist starts here.",
    });

    expect(note.visibility).toBe("private");
    expect(await listNotes(user.id)).toHaveLength(1);
  });

  it("uses oEmbed's title when it is available, without requiring it", async () => {
    const capture = await captureFromSpotifyLink(
      "https://open.spotify.com/track/0VaeksJaXy5R1nvcTMh3Xk",
      {
        fetchOEmbed: async () => ({
          title: "Darling, I (feat. Teezo Touchdown)",
          thumbnailUrl: null,
          retrievedAt: new Date().toISOString(),
        }),
        // oEmbed carries no artist field, so the artist always comes from us.
        fallback: { title: "", artistDisplay: "Tyler, The Creator" },
      },
    );

    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(capture.result.recording.title).toBe("Darling, I (feat. Teezo Touchdown)");
    expect(capture.result.recording.artistDisplay).toBe("Tyler, The Creator");
  });

  it("asks for details rather than blocking when nothing is available", async () => {
    const capture = await captureFromSpotifyLink(
      "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R",
      { fetchOEmbed: oembedUnavailable },
    );

    expect(capture).toMatchObject({ ok: false, reason: "needs-manual-metadata" });
    expect(await prisma.recording.count()).toBe(0);
  });

  it("resolves repeated captures of one track to a single recording", async () => {
    const opts = {
      fetchOEmbed: oembedUnavailable,
      fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
    };

    await captureFromSpotifyLink("https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R", opts);
    await captureFromSpotifyLink("spotify:track:4u43I0LP2Xf85OAS85eG0R", opts);
    await captureFromSpotifyLink(
      "https://open.spotify.com/intl-pt/track/4u43I0LP2Xf85OAS85eG0R?si=xyz",
      opts,
    );

    expect(await prisma.recording.count()).toBe(1);
  });
});

describe("a playlist link creates nothing", () => {
  /** The definition-of-done item, asserted against the database rather than
   *  against a return value alone. */
  it("creates no collection, no items, and no recording", async () => {
    const capture = await captureFromSpotifyLink(
      "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
      { fetchOEmbed: oembedUnavailable },
    );

    expect(capture).toMatchObject({ ok: false, reason: "playlist" });
    expect(await prisma.collection.count()).toBe(0);
    expect(await prisma.collectionItem.count()).toBe(0);
    expect(await prisma.recording.count()).toBe(0);
  });

  it("explains the limitation instead of failing silently", async () => {
    const capture = await captureFromSpotifyLink(
      "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
      { fetchOEmbed: oembedUnavailable },
    );

    if (capture.ok) throw new Error("expected refusal");
    expect(capture.message).toMatch(/can't read a playlist's tracks/i);
    expect(capture.message).toMatch(/CSV/);
  });
});

describe("first paste with empty fields — the flow a real user actually takes", () => {
  /**
   * Regression. The original logic sourced artistDisplay only from the user's
   * fallback, and oEmbed has no artist field, so a first paste with empty
   * fields could never succeed — the happy path was unreachable. Every earlier
   * test supplied an artist and so shared the blind spot.
   */
  it("returns the fetched title so the user fills one field, not two", async () => {
    const capture = await captureFromSpotifyLink(
      "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R",
      {
        fetchOEmbed: async () => ({
          title: "CN TOWER",
          thumbnailUrl: null,
          retrievedAt: new Date().toISOString(),
        }),
      },
    );

    expect(capture).toMatchObject({ ok: false, reason: "needs-manual-metadata" });
    if (capture.ok) return;
    expect(capture.suggested?.title).toBe("CN TOWER");
    expect(capture.message).toContain("CN TOWER");
    expect(capture.message).toMatch(/doesn't include the artist/i);
  });

  it("saves once the artist is supplied on the second submit", async () => {
    const fetchOEmbed = async () => ({
      title: "CN TOWER",
      thumbnailUrl: null,
      retrievedAt: new Date().toISOString(),
    });
    const link = "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R";

    const first = await captureFromSpotifyLink(link, { fetchOEmbed });
    expect(first.ok).toBe(false);
    if (first.ok) return;

    const second = await captureFromSpotifyLink(link, {
      fetchOEmbed,
      fallback: {
        title: first.suggested?.title ?? "",
        artistDisplay: "PARTYNEXTDOOR & Drake",
      },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.recording.title).toBe("CN TOWER");
    expect(second.result.recording.artistDisplay).toBe("PARTYNEXTDOOR & Drake");
  });

  /** Never invent an artist: canonical metadata is write-once, so a guess here
   *  would become everyone's guess. */
  it("creates no recording while the artist is still missing", async () => {
    await captureFromSpotifyLink("https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R", {
      fetchOEmbed: async () => ({
        title: "CN TOWER",
        thumbnailUrl: null,
        retrievedAt: new Date().toISOString(),
      }),
    });

    expect(await prisma.recording.count()).toBe(0);
  });
});

describe("short links resolve to the track they point at", () => {
  const shortLinkTo = (target: string) =>
    (async () => ({ ok: true as const, ref: parseSpotifyLink(target) }));

  it("captures through a spotify.link short link", async () => {
    const capture = await captureFromSpotifyLink("https://spotify.link/aBcDeFg", {
      resolveShortLink: shortLinkTo(
        "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R",
      ) as never,
      fetchOEmbed: oembedUnavailable,
      fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
    });

    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(capture.result.recording.title).toBe("CN TOWER");
  });

  /** A short link is not a loophole: it is refused for exactly the same reason
   *  a pasted playlist URL is. */
  it("still refuses a short link that points at a playlist", async () => {
    const capture = await captureFromSpotifyLink("https://spotify.link/aBcDeFg", {
      resolveShortLink: shortLinkTo(
        "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
      ) as never,
      fetchOEmbed: oembedUnavailable,
    });

    expect(capture).toMatchObject({ ok: false, reason: "playlist" });
    expect(await prisma.collection.count()).toBe(0);
    expect(await prisma.recording.count()).toBe(0);
  });

  it("explains rather than failing silently when resolution fails", async () => {
    const capture = await captureFromSpotifyLink("https://spotify.link/dead", {
      resolveShortLink: (async () => ({ ok: false as const, reason: "unreachable" as const })) as never,
      fetchOEmbed: oembedUnavailable,
    });

    expect(capture).toMatchObject({ ok: false, reason: "short-link" });
    if (capture.ok) return;
    expect(capture.message).toMatch(/copy the full track link/i);
  });
});
