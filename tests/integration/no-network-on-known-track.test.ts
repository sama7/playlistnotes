import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureFromSpotifyLink } from "@/lib/music/capture";
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
 * lookup above the database check in `captureFromSpotifyLink`, this suite fails
 * instead of the quota quietly draining in production.
 */

const CN_TOWER = "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R";

const metadata = {
  title: "CN TOWER",
  thumbnailUrl: null,
  retrievedAt: new Date().toISOString(),
};

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a known track never touches the network", () => {
  it("calls the provider once on first capture and never again", async () => {
    const fetchOEmbed = vi.fn().mockResolvedValue(metadata);
    const fallback = { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" };

    // First capture: the track is unknown, so one lookup is expected.
    const first = await captureFromSpotifyLink(CN_TOWER, { fetchOEmbed, fallback });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.source).toBe("provider");
    expect(fetchOEmbed).toHaveBeenCalledTimes(1);

    // Nine more pastes by anyone at all.
    for (let i = 0; i < 9; i++) {
      const repeat = await captureFromSpotifyLink(CN_TOWER, { fetchOEmbed, fallback });
      expect(repeat.ok).toBe(true);
      if (repeat.ok) expect(repeat.source).toBe("database");
    }

    expect(fetchOEmbed).toHaveBeenCalledTimes(1);
    expect(await prisma.recording.count()).toBe(1);
  });

  it("resolves from the database across every URL form of the same track", async () => {
    const fetchOEmbed = vi.fn().mockResolvedValue(metadata);
    await captureFromSpotifyLink(CN_TOWER, {
      fetchOEmbed,
      fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
    });
    expect(fetchOEmbed).toHaveBeenCalledTimes(1);

    for (const form of [
      "spotify:track:4u43I0LP2Xf85OAS85eG0R",
      "https://open.spotify.com/intl-pt/track/4u43I0LP2Xf85OAS85eG0R",
      "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R?si=share-token",
      "  open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R  ",
    ]) {
      const result = await captureFromSpotifyLink(form, { fetchOEmbed });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.source).toBe("database");
    }

    // Still one — the share token and locale prefix do not defeat the cache.
    expect(fetchOEmbed).toHaveBeenCalledTimes(1);
  });

  /**
   * A known track needs no user input either: the second paste succeeds with
   * empty fields, because the artist is already in our database.
   */
  it("needs no metadata from the user once the track is known", async () => {
    const fetchOEmbed = vi.fn().mockResolvedValue(metadata);
    await captureFromSpotifyLink(CN_TOWER, {
      fetchOEmbed,
      fallback: { title: "CN TOWER", artistDisplay: "PARTYNEXTDOOR & Drake" },
    });

    const second = await captureFromSpotifyLink(CN_TOWER, { fetchOEmbed });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.recording.artistDisplay).toBe("PARTYNEXTDOOR & Drake");
    expect(fetchOEmbed).toHaveBeenCalledTimes(1);
  });

  /** Refusals must not spend quota either. */
  it("makes no provider call for a playlist, an album, or a bad host", async () => {
    const fetchOEmbed = vi.fn().mockResolvedValue(metadata);

    await captureFromSpotifyLink("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6", {
      fetchOEmbed,
    });
    await captureFromSpotifyLink("https://open.spotify.com/album/6Rl6YoCarF2GHPSQmmFjuR", {
      fetchOEmbed,
    });
    await captureFromSpotifyLink("https://open.spotify.com.evil.com/track/x", { fetchOEmbed });

    expect(fetchOEmbed).not.toHaveBeenCalled();
  });
});
