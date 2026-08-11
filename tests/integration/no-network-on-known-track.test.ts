import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureFromLink } from "@/lib/music/capture-track";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * The rate-limit guarantee, asserted rather than asserted-about.
 *
 * Spotify's limit is per app over a rolling 30-second window, and Development
 * Mode's is lower than Extended Quota's. That is survivable only because
 * provider requests scale with **catalog growth**, not with usage: a track we
 * already hold resolves entirely from PostgreSQL.
 *
 * These tests count network calls directly. If anyone ever reintroduces a
 * lookup above the database check in `captureFromLink`, this suite fails instead
 * of the quota quietly draining in production.
 *
 * **Both provider paths are counted.** Capture prefers the Web API when a
 * credential is configured and falls back to oEmbed when it is not, so counting
 * only one of them would let the other escape the guarantee on exactly the
 * machines where it is active. `providerCalls` sums them, and every test injects
 * both so nothing here can reach the real network whatever the local
 * environment holds.
 */

const CN_TOWER = "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R";

const oembedMetadata = {
  title: "CN TOWER",
  thumbnailUrl: null,
  retrievedAt: new Date().toISOString(),
};

const webApiTrack = {
  id: "4u43I0LP2Xf85OAS85eG0R",
  name: "CN TOWER",
  artists: [
    { id: "2HPaUgqeutzr3jx5a9WyDd", name: "PARTYNEXTDOOR" },
    { id: "3TVXtAsR1Inumwj472S9r4", name: "Drake" },
  ],
  artistDisplay: "PARTYNEXTDOOR, Drake",
  durationMs: 189_000,
  isrc: "USUG12403756",
  album: {
    id: "6Rl6YoCarF2GHPSQmmFjuR",
    name: "$OME $EXY $ONGS 4 U",
    artists: [
      { id: "2HPaUgqeutzr3jx5a9WyDd", name: "PARTYNEXTDOOR" },
      { id: "3TVXtAsR1Inumwj472S9r4", name: "Drake" },
    ],
    releaseDate: "2025-02-14",
  },
  trackNumber: 4,
};

function providerMocks() {
  const fetchOEmbed = vi.fn().mockResolvedValue(oembedMetadata);
  const fetchTrackImpl = vi.fn().mockResolvedValue(webApiTrack);
  return {
    fetchOEmbed,
    fetchTrackImpl,
    fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
    get providerCalls() {
      return fetchOEmbed.mock.calls.length + fetchTrackImpl.mock.calls.length;
    },
  };
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a known track never touches the network", () => {
  it("calls the provider once on first capture and never again", async () => {
    const m = providerMocks();

    // First capture: the track is unknown, so exactly one lookup is expected.
    const first = await captureFromLink(CN_TOWER, m);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.source).not.toBe("database");
    expect(m.providerCalls).toBe(1);

    // Nine more pastes by anyone at all.
    for (let i = 0; i < 9; i++) {
      const repeat = await captureFromLink(CN_TOWER, m);
      expect(repeat.ok).toBe(true);
      if (repeat.ok) expect(repeat.source).toBe("database");
    }

    expect(m.providerCalls).toBe(1);
    expect(await prisma.recording.count()).toBe(1);
  });

  it("resolves from the database across every URL form of the same track", async () => {
    const m = providerMocks();
    await captureFromLink(CN_TOWER, m);
    expect(m.providerCalls).toBe(1);

    for (const form of [
      "spotify:track:4u43I0LP2Xf85OAS85eG0R",
      "https://open.spotify.com/intl-pt/track/4u43I0LP2Xf85OAS85eG0R",
      "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R?si=share-token",
      "  open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R  ",
    ]) {
      const result = await captureFromLink(form, m);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.source).toBe("database");
    }

    // Still one — the share token and locale prefix do not defeat the cache.
    expect(m.providerCalls).toBe(1);
  });

  /**
   * A known track needs no user input either: the second paste succeeds with
   * empty fields, because the artist is already in our database.
   */
  it("needs no metadata from the user once the track is known", async () => {
    const m = providerMocks();
    await captureFromLink(CN_TOWER, m);

    const second = await captureFromLink(CN_TOWER, {
      fetchOEmbed: m.fetchOEmbed,
      fetchTrackImpl: m.fetchTrackImpl,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.recording.artistDisplay).toMatch(/PARTYNEXTDOOR/);
    expect(m.providerCalls).toBe(1);
  });

  /** Refusals must not spend quota either. */
  it("makes no provider call for a playlist, an album, or a bad host", async () => {
    const m = providerMocks();

    await captureFromLink("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6", m);
    await captureFromLink("https://open.spotify.com/album/6Rl6YoCarF2GHPSQmmFjuR", m);
    await captureFromLink("https://open.spotify.com.evil.com/track/x", m);
    await captureFromLink("https://music.apple.com/us/album/iceman/1839574264", m);

    expect(m.providerCalls).toBe(0);
  });
});
