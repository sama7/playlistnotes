#!/usr/bin/env node
/**
 * A stand-in for Last.fm, so CI can exercise the connected experience.
 *
 * ## Why this exists rather than a credential
 *
 * Green CI did not demonstrate the Last.fm feature at all: the browser tests
 * for it are gated on the integration being configured, CI holds no Last.fm
 * credentials, and so every one of them skipped. The feature a person actually
 * uses was verified by hand or not at all.
 *
 * Giving CI a real key would not have fixed it. The suite would then depend on
 * a third party's uptime, on one real account's listening, and on rows that
 * differ between runs — so a failure would mean "Last.fm changed" as often as
 * "we broke something", and nobody would trust it. The point of a test is to
 * fail for exactly one reason.
 *
 * This answers with fixed JSON in Last.fm's own shapes, including the awkward
 * ones the real API produces:
 *
 *   - a now-playing track, which carries `@attr.nowplaying` and **no** `date`
 *   - a completed play with a `uts` timestamp
 *   - the same track played twice, which must stay two listens
 *   - a track with no MusicBrainz id, which must stay creator-scoped
 *
 * Usage: node scripts/lastfm-fixture-server.mjs [port]
 */

import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 4599);

/** Fixed instants, so a rendered date is the same on every run. */
const PLAYED = {
  recent: 1789000000, // 2026-09-08T19:06:40Z
  earlier: 1788990000,
  yesterday: 1788910000,
};

const track = (name, artist, uts, extra = {}) => ({
  name,
  artist: { "#text": artist, mbid: extra.artistMbid ?? "" },
  album: { "#text": extra.album ?? "", mbid: "" },
  mbid: extra.mbid ?? "",
  url: `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(name)}`,
  ...(uts === null
    ? { "@attr": { nowplaying: "true" } }
    : { date: { uts: String(uts), "#text": "08 Sep 2026, 19:06" } }),
});

/**
 * Page 1 is what the strip shows and polls. Page 2 is what "Show earlier
 * listens" reaches, and it is deliberately different — a test that could not
 * tell the two pages apart would pass whether or not paging worked.
 */
const PAGES = {
  1: [
    track("Rasiya", "Anyasa", null, { album: "Rasiya" }),
    track("206", "Joe James", PLAYED.recent, { album: "The Ends, Never Ends" }),
    // The same recording again, earlier. Two hearings are two listens; merging
    // them silently is the one outcome the listens model must never produce.
    track("206", "Joe James", PLAYED.earlier, { album: "The Ends, Never Ends" }),
  ],
  2: [
    track("AMA NACHLE", "Mrii", PLAYED.yesterday, {
      album: "AMA NACHLE - Single",
      mbid: "b1e2c3d4-0000-4000-8000-0000000000aa",
    }),
  ],
};

function body(method, params) {
  switch (method) {
    case "auth.getsession":
      // Any token is accepted: this stands in for a person having approved
      // access, and the approval itself is Last.fm's to judge, not ours.
      return { session: { name: "fixture-listener", key: "fixture-session-key" } };
    case "user.getinfo":
      return { user: { name: params.get("user") ?? "fixture-listener" } };
    case "user.getrecenttracks": {
      const page = Number(params.get("page") ?? "1");
      return { recenttracks: { track: PAGES[page] ?? [] } };
    }
    case "track.getinfo":
      return { track: { duration: "228000" } };
    default:
      return { error: 3, message: `fixture has no answer for ${method}` };
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Stands in for Last.fm's approval page: bounce straight back to the
  // callback with a token, which is what a person clicking "Yes, allow access"
  // causes to happen.
  if (url.pathname.startsWith("/api/auth")) {
    const cb = url.searchParams.get("cb");
    if (!cb) {
      res.writeHead(400).end("no callback");
      return;
    }
    const back = new URL(cb);
    back.searchParams.set("token", "fixture-token");
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }

  const method = (url.searchParams.get("method") ?? "").toLowerCase();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body(method, url.searchParams)));
});

server.listen(PORT, () => {
  console.log(`Last.fm fixture listening on http://127.0.0.1:${PORT}`);
});
