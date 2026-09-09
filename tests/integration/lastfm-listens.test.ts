import { DatePrecision, ListenSource, PrismaClient, Provider, RecordingOrigin } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LastfmNotLinkedError,
  importListen,
  invalidateLastfmSession,
  syncRecentListens,
  unlinkLastfm,
} from "@/lib/listens/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Turning a listening history into notes, and the catalog rules that constrain
 * how much of it is allowed to become shared truth.
 *
 * The riskiest thing here is not the HTTP call — that is unit-tested against
 * recorded shapes — it is the resolution fork. Last.fm may not establish
 * recording identity (AGENTS.md), so a scrobble with a MusicBrainz id resolves
 * through the ordinary trusted-provider path while one without stays scoped to
 * its creator. Getting that backwards would quietly fill the shared catalog with
 * name-matched guesses, which is the one outcome the catalog policy exists to
 * prevent.
 */

const PLAYED_AT = new Date("2026-09-08T19:39:00.000Z");
const MBID = "b1e2c3d4-0000-4000-8000-0000000000aa";

function lastfmResponse(tracks: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ recenttracks: { track: tracks } }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function play(overrides: Record<string, unknown> = {}) {
  return {
    name: "CN TOWER",
    mbid: "",
    url: "https://www.last.fm/music/PARTYNEXTDOOR/_/CN+TOWER",
    artist: { "#text": "PARTYNEXTDOOR", mbid: "" },
    album: { "#text": "$ome $exy $ongs 4 U", mbid: "" },
    date: { uts: String(Math.floor(PLAYED_AT.getTime() / 1000)) },
    ...overrides,
  };
}

async function makeUser(lastfmUsername: string | null = "samah-") {
  return prisma.user.create({
    data: { authSubject: `s_${crypto.randomUUID()}`, lastfmUsername },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
  vi.stubEnv("LASTFM_API_KEY", "test-key");
  vi.stubEnv("LASTFM_SHARED_SECRET", "s3cr3t");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("disconnecting", () => {
  /**
   * Disconnecting a source is not a request to delete your own writing. The
   * opposite would make connecting it feel like a trap.
   */
  it("keeps listens and notes, and destroys the credential", async () => {
    const user = await prisma.user.create({
      data: {
        authSubject: `s_${crypto.randomUUID()}`,
        lastfmUsername: "samah-",
        lastfmSessionKey: "a-session-key",
      },
    });
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(user.id);
    await importListen(user.id, {
      sourceRef: (await prisma.listen.findFirstOrThrow({ where: { ownerId: user.id } })).sourceRef,
      body: "the city sounds under the intro",
    });

    await unlinkLastfm(user.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastfmUsername).toBeNull();
    // A disconnected account must leave no usable credential behind.
    expect(after.lastfmSessionKey).toBeNull();
    expect(await prisma.listen.count({ where: { ownerId: user.id } })).toBe(1);
    expect(await prisma.note.count({ where: { ownerId: user.id } })).toBe(1);
  });

  it("refuses to read a feed for a user who has connected none", async () => {
    const user = await makeUser(null);
    await expect(syncRecentListens(user.id)).rejects.toThrow(LastfmNotLinkedError);
  });

  it("forgets only the credential when Last.fm rejects it", async () => {
    const user = await prisma.user.create({
      data: {
        authSubject: `s_${crypto.randomUUID()}`,
        lastfmUsername: "samah-",
        lastfmSessionKey: "revoked",
      },
    });

    await invalidateLastfmSession(user.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastfmSessionKey).toBeNull();
    // The username stays, so the UI can say "reconnect" rather than "connect".
    expect(after.lastfmUsername).toBe("samah-");
  });
});

describe("reading as the connected account", () => {
  /**
   * The reason the approval flow exists: a profile that hides its listening
   * returns error 17 to a public read, and a signed read gets through.
   */
  it("signs the request when a session key is held", async () => {
    const user = await prisma.user.create({
      data: {
        authSubject: `s_${crypto.randomUUID()}`,
        lastfmUsername: "womenaresmarter",
        lastfmSessionKey: "the-session-key",
      },
    });

    let seen: URL | null = null;
    vi.stubGlobal("fetch", (async (url: URL) => {
      seen = url;
      return new Response(JSON.stringify({ recenttracks: { track: [play()] } }));
    }) as unknown as typeof fetch);

    await syncRecentListens(user.id);

    expect(seen!.searchParams.get("sk")).toBe("the-session-key");
    expect(seen!.searchParams.get("api_sig")).toMatch(/^[0-9a-f]{32}$/);
  });

  /**
   * A server holding session keys but missing the shared secret cannot sign
   * anything. Failing every read would be worse than reading publicly, which
   * still works for every profile that hides nothing.
   */
  it("falls back to a public read when signing is impossible", async () => {
    const user = await prisma.user.create({
      data: {
        authSubject: `s_${crypto.randomUUID()}`,
        lastfmUsername: "samah-",
        lastfmSessionKey: "unusable-without-a-secret",
      },
    });
    vi.stubEnv("LASTFM_SHARED_SECRET", "");

    let seen: URL | null = null;
    vi.stubGlobal("fetch", (async (url: URL) => {
      seen = url;
      return new Response(JSON.stringify({ recenttracks: { track: [play()] } }));
    }) as unknown as typeof fetch);

    await expect(syncRecentListens(user.id)).resolves.toHaveLength(1);
    expect(seen!.searchParams.get("sk")).toBeNull();
  });

  /**
   * A revoked key makes even a public profile fail while it is still stored.
   * Clearing it must leave the account in a state that works, not one that
   * errors until the next visit.
   */
  it("clears a rejected key, leaving the next read able to succeed publicly", async () => {
    const user = await prisma.user.create({
      data: {
        authSubject: `s_${crypto.randomUUID()}`,
        lastfmUsername: "samah-",
        lastfmSessionKey: "revoked-key",
      },
    });

    vi.stubGlobal("fetch", (async (url: URL) =>
      url.searchParams.get("sk")
        ? new Response(JSON.stringify({ error: 9, message: "Invalid session key" }), { status: 403 })
        : new Response(JSON.stringify({ recenttracks: { track: [play()] } }))) as unknown as typeof fetch);

    await expect(syncRecentListens(user.id)).rejects.toMatchObject({ reason: "bad-session" });
    await invalidateLastfmSession(user.id);

    // With the dead key gone, the very same feed reads publicly.
    await expect(syncRecentListens(user.id)).resolves.toHaveLength(1);
  });

  it("makes an ordinary public read when there is no session key", async () => {
    const user = await makeUser();
    let seen: URL | null = null;
    vi.stubGlobal("fetch", (async (url: URL) => {
      seen = url;
      return new Response(JSON.stringify({ recenttracks: { track: [play()] } }));
    }) as unknown as typeof fetch);

    await syncRecentListens(user.id);

    expect(seen!.searchParams.get("sk")).toBeNull();
    expect(seen!.searchParams.get("api_sig")).toBeNull();
  });
});

describe("syncing the recent feed", () => {
  it("records the play instant and the raw strings the source reported", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play({ mbid: MBID })]));

    await syncRecentListens(user.id);

    const listen = await prisma.listen.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(listen.playedAt.toISOString()).toBe(PLAYED_AT.toISOString());
    expect(listen.trackName).toBe("CN TOWER");
    expect(listen.artistName).toBe("PARTYNEXTDOOR");
    expect(listen.albumName).toBe("$ome $exy $ongs 4 U");
    expect(listen.recordingMbid).toBe(MBID);
    expect(listen.source).toBe(ListenSource.lastfm);
  });

  /** Re-reading the same window must not duplicate a person's history. */
  it("is idempotent across repeated syncs", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play(), play({ date: { uts: "1756400000" } })]));

    await syncRecentListens(user.id);
    await syncRecentListens(user.id);
    await syncRecentListens(user.id);

    expect(await prisma.listen.count({ where: { ownerId: user.id } })).toBe(2);
  });

  it("fills in a MusicBrainz id that a later read supplies", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(user.id);
    expect((await prisma.listen.findFirstOrThrow({})).recordingMbid).toBeNull();

    vi.stubGlobal("fetch", lastfmResponse([play({ mbid: MBID })]));
    await syncRecentListens(user.id);

    expect((await prisma.listen.findFirstOrThrow({})).recordingMbid).toBe(MBID);
    expect(await prisma.listen.count()).toBe(1);
  });

  /** A track still playing is not yet a play Last.fm has reported. */
  it("shows a now-playing track without persisting it", async () => {
    const user = await makeUser();
    vi.stubGlobal(
      "fetch",
      lastfmResponse([play({ date: undefined, "@attr": { nowplaying: "true" } })]),
    );

    const view = await syncRecentListens(user.id);

    expect(view).toHaveLength(1);
    expect(view[0]!.playedAt).toBeNull();
    expect(await prisma.listen.count({ where: { ownerId: user.id } })).toBe(0);
  });

  it("never returns another user's listens", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(alice.id);

    expect(await prisma.listen.count({ where: { ownerId: bob.id } })).toBe(0);
  });
});

describe("what a scrobble is allowed to create", () => {
  async function importFirst(userId: string, body = "a jot") {
    const listen = await prisma.listen.findFirstOrThrow({ where: { ownerId: userId } });
    return importListen(userId, { sourceRef: listen.sourceRef, body });
  }

  /**
   * With a MusicBrainz id there is an identifier to resolve by, so the ordinary
   * trusted-provider path applies.
   */
  it("anchors a play carrying a MusicBrainz id to that identifier", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play({ mbid: MBID })]));
    await syncRecentListens(user.id);

    await importFirst(user.id);

    const external = await prisma.recordingExternalId.findUniqueOrThrow({
      where: { provider_providerId: { provider: Provider.musicbrainz, providerId: MBID } },
      include: { recording: true },
    });
    expect(external.recording.origin).toBe(RecordingOrigin.provider);
    expect(external.recording.title).toBe("CN TOWER");
  });

  /**
   * Without one there is nothing but names, and the catalog policy forbids
   * creating a shared entity from those. A creator-scoped row is the correct,
   * duplicate-tolerating answer.
   */
  it("keeps a play with no identifier scoped to its creator", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(user.id);

    await importFirst(user.id);

    const recording = await prisma.recording.findFirstOrThrow({ where: { title: "CN TOWER" } });
    expect(recording.origin).toBe(RecordingOrigin.user);
    expect(recording.createdById).toBe(user.id);
    expect(await prisma.recordingExternalId.count()).toBe(0);
  });

  /** Last.fm supplies artists and albums as names, and a name is not an id. */
  it("creates no artist or album rows from what Last.fm called things", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play({ mbid: MBID })]));
    await syncRecentListens(user.id);

    await importFirst(user.id);

    expect(await prisma.artist.count()).toBe(0);
    expect(await prisma.album.count()).toBe(0);
    // The album title survives as display data, which is what it is.
    const recording = await prisma.recording.findFirstOrThrow({});
    expect(recording.releaseTitle).toBe("$ome $exy $ongs 4 U");
  });

  it("reuses a recording already held under the same MusicBrainz id", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    vi.stubGlobal("fetch", lastfmResponse([play({ mbid: MBID })]));
    await syncRecentListens(alice.id);
    await syncRecentListens(bob.id);

    await importFirst(alice.id, "alice heard it");
    await importFirst(bob.id, "bob heard it");

    expect(await prisma.recording.count()).toBe(1);
    expect(await prisma.note.count()).toBe(2);
  });

  it("gives two people two rows when there is no identifier to share", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(alice.id);
    await syncRecentListens(bob.id);

    await importFirst(alice.id);
    await importFirst(bob.id);

    // A duplicate is cheap; a false merge is not.
    expect(await prisma.recording.count()).toBe(2);
  });
});

describe("the note a play becomes", () => {
  it("is dated when it was heard, to the minute", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(user.id);
    const listen = await prisma.listen.findFirstOrThrow({});

    await importListen(user.id, { sourceRef: listen.sourceRef, body: "heard on the walk home" });

    const note = await prisma.note.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(note.experiencedAt?.toISOString()).toBe(PLAYED_AT.toISOString());
    expect(note.experiencedPrecision).toBe(DatePrecision.time);
    // Written now, heard earlier: the two dates are different on purpose.
    expect(note.createdAt.getTime()).toBeGreaterThan(PLAYED_AT.getTime());
  });

  it("is private, like every other note", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(user.id);
    const listen = await prisma.listen.findFirstOrThrow({});

    await importListen(user.id, { sourceRef: listen.sourceRef, body: "mine" });

    expect((await prisma.note.findFirstOrThrow({})).visibility).toBe("private");
  });

  it("marks the play as imported, so the strip stops offering it", async () => {
    const user = await makeUser();
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(user.id);
    const listen = await prisma.listen.findFirstOrThrow({});

    await importListen(user.id, { sourceRef: listen.sourceRef, body: "jotted" });

    const after = await prisma.listen.findUniqueOrThrow({ where: { id: listen.id } });
    expect(after.importedAt).not.toBeNull();
    expect(after.recordingId).not.toBeNull();

    const view = await syncRecentListens(user.id);
    expect(view[0]!.importedNoteId).not.toBeNull();
  });

  it("refuses a play belonging to somebody else, given its real ref", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    vi.stubGlobal("fetch", lastfmResponse([play()]));
    await syncRecentListens(alice.id);
    const hers = await prisma.listen.findFirstOrThrow({ where: { ownerId: alice.id } });

    await expect(
      importListen(bob.id, { sourceRef: hers.sourceRef, body: "not mine to take" }),
    ).rejects.toThrow(LastfmNotLinkedError);
    expect(await prisma.note.count()).toBe(0);
  });

  /**
   * Jotting a song while it plays, then having Last.fm report the finished
   * play, must leave one listen — not the imported one plus an orphan.
   */
  it("folds the completed scrobble into a now-playing capture", async () => {
    const user = await makeUser();
    const nowPlaying = play({ date: undefined, "@attr": { nowplaying: "true" } });
    vi.stubGlobal("fetch", lastfmResponse([nowPlaying]));
    const [live] = await syncRecentListens(user.id);

    await importListen(user.id, {
      sourceRef: live!.sourceRef,
      body: "caught this one live",
      track: {
        trackName: live!.trackName,
        artistName: live!.artistName,
        albumName: live!.albumName,
        playedAt: null,
        recordingMbid: null,
        artistMbid: null,
        albumMbid: null,
        url: live!.url,
        sourceRef: live!.sourceRef,
      },
    });
    expect(await prisma.listen.count({ where: { ownerId: user.id } })).toBe(1);

    // Last.fm now reports the finished play with a real timestamp.
    vi.stubGlobal(
      "fetch",
      lastfmResponse([play({ date: { uts: String(Math.floor(Date.now() / 1000)) } })]),
    );
    await syncRecentListens(user.id);

    const listens = await prisma.listen.findMany({ where: { ownerId: user.id } });
    expect(listens).toHaveLength(1);
    expect(listens[0]!.sourceRef.startsWith("nowplaying:")).toBe(false);
    expect(listens[0]!.importedAt).not.toBeNull();
  });
});
