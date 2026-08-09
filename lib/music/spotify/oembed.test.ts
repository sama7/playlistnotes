import { describe, expect, it, vi } from "vitest";
import { fetchSpotifyOEmbed } from "./oembed";

const CN_TOWER = "4u43I0LP2Xf85OAS85eG0R";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("fetchSpotifyOEmbed", () => {
  it("returns the title and a Spotify-hosted thumbnail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        title: "CN TOWER",
        thumbnail_url: "https://i.scdn.co/image/ab67616d0000b273abc",
      }),
    );

    const result = await fetchSpotifyOEmbed("track", CN_TOWER, { fetchImpl });

    expect(result?.title).toBe("CN TOWER");
    expect(result?.thumbnailUrl).toBe("https://i.scdn.co/image/ab67616d0000b273abc");
    expect(result?.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /** The URL is rebuilt from validated parts, never taken from user input. */
  it("requests the canonical URL for the given id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: "x" }));
    await fetchSpotifyOEmbed("track", CN_TOWER, { fetchImpl });

    const [requested] = fetchImpl.mock.calls[0] as [string];
    expect(requested).toBe(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(
        `https://open.spotify.com/track/${CN_TOWER}`,
      )}`,
    );
  });

  it("refuses to follow a redirect away from Spotify", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: "x" }));
    await fetchSpotifyOEmbed("track", CN_TOWER, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("error");
  });

  /**
   * Every one of these must yield null rather than throwing. A note is created
   * regardless of what oEmbed does — that is the core independence invariant.
   */
  it.each([
    ["a network error", () => Promise.reject(new Error("ECONNREFUSED"))],
    ["a 404", () => Promise.resolve(new Response("", { status: 404 }))],
    ["a 429", () => Promise.resolve(new Response("", { status: 429 }))],
    ["a 500", () => Promise.resolve(new Response("", { status: 500 }))],
    ["malformed JSON", () => Promise.resolve(new Response("<html>nope</html>", { status: 200 }))],
    ["a JSON array", () => Promise.resolve(jsonResponse([1, 2, 3]))],
    ["null", () => Promise.resolve(jsonResponse(null))],
  ])("returns null on %s, and does not throw", async (_label, impl) => {
    const result = await fetchSpotifyOEmbed("track", CN_TOWER, {
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it("gives up rather than hanging when the endpoint stalls", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const result = await fetchSpotifyOEmbed("track", CN_TOWER, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });

    expect(result).toBeNull();
  });

  it("drops a thumbnail hosted anywhere but Spotify's CDN", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ title: "CN TOWER", thumbnail_url: "https://evil.com/tracker.png" }),
    );

    const result = await fetchSpotifyOEmbed("track", CN_TOWER, { fetchImpl });

    expect(result?.title).toBe("CN TOWER");
    expect(result?.thumbnailUrl).toBeNull();
  });

  it("rejects an oversized body rather than buffering it", async () => {
    const huge = JSON.stringify({ title: "x".repeat(200_000) });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(huge, { status: 200, headers: { "content-type": "application/json" } }),
    );

    expect(await fetchSpotifyOEmbed("track", CN_TOWER, { fetchImpl })).toBeNull();
  });

  it("caps a long title rather than storing it whole", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ title: "y".repeat(2_000) }));

    const result = await fetchSpotifyOEmbed("track", CN_TOWER, { fetchImpl });
    expect(result?.title).toHaveLength(500);
  });
});
