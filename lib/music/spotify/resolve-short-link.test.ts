import { describe, expect, it, vi } from "vitest";
import { resolveSpotifyShortLink } from "./resolve-short-link";

const TRACK = "https://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R";

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

describe("resolveSpotifyShortLink", () => {
  it("follows a short link to the track it points at", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectTo(`${TRACK}?si=abc123`));

    const result = await resolveSpotifyShortLink("https://spotify.link/aBcDeFg", { fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref).toMatchObject({ kind: "track", id: "4u43I0LP2Xf85OAS85eG0R" });
  });

  it("never lets the runtime follow the redirect itself", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectTo(TRACK));
    await resolveSpotifyShortLink("https://spotify.link/aBcDeFg", { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("HEAD");
  });

  /**
   * The attack this function exists to stop. Checking only the pasted URL would
   * let the redirect chain deliver a target we would have refused outright.
   */
  it.each([
    ["an internal metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["loopback", "http://127.0.0.1:5432/"],
    ["a look-alike host", "https://open.spotify.com.evil.com/track/4u43I0LP2Xf85OAS85eG0R"],
    ["an unrelated host", "https://evil.com/track/4u43I0LP2Xf85OAS85eG0R"],
    ["a downgrade to http", "http://open.spotify.com/track/4u43I0LP2Xf85OAS85eG0R"],
  ])("refuses a redirect to %s", async (_label, target) => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectTo(target));

    const result = await resolveSpotifyShortLink("https://spotify.link/aBcDeFg", { fetchImpl });

    expect(result).toEqual({ ok: false, reason: "left-allowlist" });
  });

  it("survives a chain that stays on Spotify", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("https://spotify.link/second"))
      .mockResolvedValueOnce(redirectTo(TRACK));

    const result = await resolveSpotifyShortLink("https://spotify.link/first", { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref).toMatchObject({ kind: "track" });
  });

  it("gives up rather than looping forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectTo("https://spotify.link/round-and-round"));

    const result = await resolveSpotifyShortLink("https://spotify.link/start", { fetchImpl });

    expect(result).toEqual({ ok: false, reason: "too-many-hops" });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("resolves a short link that points at a playlist, so it can still be refused", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(redirectTo("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6"));

    const result = await resolveSpotifyShortLink("https://spotify.link/aBcDeFg", { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref.kind).toBe("playlist");
  });

  it("returns not-a-short-link for a normal URL rather than fetching it", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveSpotifyShortLink(TRACK, { fetchImpl });

    expect(result).toEqual({ ok: false, reason: "not-a-short-link" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["a network failure", () => Promise.reject(new Error("ECONNREFUSED"))],
    ["a dead link with no location", () => Promise.resolve(new Response(null, { status: 404 }))],
  ])("returns unreachable on %s", async (_label, impl) => {
    const result = await resolveSpotifyShortLink("https://spotify.link/aBcDeFg", {
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
  });

  it("gives up rather than hanging", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const result = await resolveSpotifyShortLink("https://spotify.link/aBcDeFg", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });

    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });
});
