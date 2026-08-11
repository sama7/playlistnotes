# Migration status

Durable handoff between sessions. Read this before relying on chat context. Update it after every phase and before ending a substantial session.

**Last updated:** August 10, 2026
**Current phase:** Phase 2 complete; Phase 3 (collections) largely complete ahead of schedule
**Checkpoint 1a: PASSED.** The schema review produced two corrections, both now merged — `album_artists` was built, and the `Provider` enum was cut back to authoritative sources.
**Next milestone:** Apple Music capture, then Managed PostgreSQL and the first gated deployment.

**Progress: roughly 55%.** Estimated 25–35 hours remain, or 10–14 working days at 2–3 h/day — the week of August 24. That is over the original 15-day estimate, because album and playlist import were not in the plan.

---

## Decisions already made — do not re-ask

| Question | Answer |
| --- | --- |
| Where does v2 code live? | The long-lived **`v2` branch** of `sama7/playlistnotes`. Not a new repo, not the `~/Documents` planning directory. |
| Branch strategy | `main` **frozen** (v1 production). `develop` is a stale byte-identical duplicate of `main`; leave it untouched and delete after v2 ships. All work on `v2`. Short-lived `v2/<slice>` branches with PRs only for auth and privacy diffs. |
| Staging hostname | `v2.playlistnotes.io` — gated, `noindex`, non-canonical. GoDaddy A record to the droplet. |
| Production database | DigitalOcean Managed PostgreSQL, provisioned at the start. |
| Build strategy | **GitHub Actions builds; the droplet only runs.** Next.js `output: 'standalone'` + rsync. |
| Timebox | ~15 working days at 2–3 focused hours/day. Full definition of done retained; CSV import not cut. |
| v1 during the sprint | Stays running and **writable**. Code frozen. Not rebuilt. |
| Package manager | npm. |
| Playlist links | Provenance on a collection only — never create a collection or items. |
| Artists / albums | Entity tables, linked from provider IDs only. **Both** `recording_artists` and `album_artists` are join tables carrying `position` and `credit_name`; `primary_artist_id` was removed because a single FK silently dropped the second artist of a joint album. |
| Trusted providers | `spotify`, `apple_music`, `deezer`, `tidal`, `musicbrainz`, `discogs`. **A trusted provider is one whose identifier is issued by an authority, not chosen by an uploader** (`AGENTS.md` §3a.4). YouTube, Bandcamp, SoundCloud, Last.fm and RYM are excluded. |
| Clerk webhooks | Out of scope. Lazy upsert on first authenticated request. |

## Operational facts

| Fact | Value |
| --- | --- |
| Heroku app | `playlistnotes` |
| Heroku deploys | **Automatic deploys from `main` are ENABLED** — confirmed by the user, not inferred |
| DNS | GoDaddy, records currently configured for Heroku |
| Droplet | 1 vCPU / 2 GB RAM / 50 GB disk, NYC1, $12/mo (resized Aug 7 from 1 GB). Address kept out of this public repo; it is in the DigitalOcean console. |
| Droplet co-tenant | **MKDb** — pm2 `server` + `mankbot`, nginx → Node on `localhost:3000`, local PostgreSQL 16 over UNIX socket, Let's Encrypt, weekly crontab. **Never modify any of it.** |
| Playlistnotes port | `127.0.0.1:3001`, pm2 process `playlistnotes`, own nginx vhost and certificate |
| Legacy data | 34 user documents, 33 notes, nothing written since 2024 |
| Spotify cohort | 20 users, grandfathered above the current 5-user cap; no further users can be added |
| Local toolchain | Node v24.1.0, npm 11.3.0, PostgreSQL 16.9 (Homebrew) on :5432, mongosh, mongodump, heroku CLI. No Docker, no `gh`. |
| Git remote | One remote named **`github`**. There is no `origin`. |

## Verified v1 state

- `main` and `develop` both at `32d028e` (2024-07-15), zero divergence.
- No `AGENTS.md`, `CLAUDE.md`, Cursor, or Copilot files existed — not in the tree, not anywhere in history.
- No CI. No meaningful tests.
- `config.env` and `client/.env` are gitignored and **were never committed** (verified across all refs).
- MongoDB model: `users {user, accessToken, refreshToken, expiresIn, lastModified}` and `notes {user, playlist, track, note, timeCreated, timeModified}` — all keys are Spotify IDs. Update/delete match on `{user, playlist, track}`, so v1 permits at most one note per (user, playlist, track).

### Known v1 defects (do not patch; replaced by v2)

1. **No server-side authorization on the note endpoints** — the acting owner is taken from client input rather than a verified session, so note reads and mutations are not owner-scoped. The exposure is **not** bounded by the five-user Spotify cap. Details are deliberately omitted here because this repository is public and v1 is still live; **known, accepted, time-boxed, and closed at cutover.**
2. Access and refresh tokens are `console.log`'d — `routes/authorize.js:111,115,177,178`. Live tokens are in Heroku's log stream.
3. One module-level mutable Spotify client shared across requests — `routes/authorize.js:34`. `setAccessToken` races under concurrency.
4. The 429 handler can leave `retryIntervalID` set permanently, hard-failing every route.
5. `client_id` hardcoded at `routes/authorize.js:31` (public value, no action needed).
6. CRA deprecated; Node pinned to EOL `18.12.1` → **v1 likely no longer rebuilds on Heroku.**

## Completed

- **Phase 0.** `v2` branch created from `main` at `32d028e`. `AGENTS.md` and `CLAUDE.md` reconciled with all decisions above and committed (`5b2de48`). Report archived to `docs/v2-plan/` as non-normative with a divergence table.
- **DR backup taken** (August 9) — see the section below.
- **v1 application source removed** from the `v2` branch: 37 files, verified recoverable from `main`, `develop` and `github/main` first. `config.env` untouched.
- **Phase 1, through the schema.** Next.js 16 / React 19 / TypeScript 5.9 / Prisma 6.19 scaffold, full v2 schema, initial migration, seed data, guarded local reset, CI workflow (`3f7a7d5`, `1943a0d`).

### Verification actually run — August 7, 2026

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 7/7 passing (`normalizedKey`) |
| `npx prisma migrate dev` | `20260808021705_init` applied to an empty database |
| `npx prisma migrate status` | up to date |
| `npm run db:seed` | 2 users, 3 artists, 1 album, 3 recordings, 3 recording-artist credits, 2 collections, 5 items, 4 notes, 2 imports, 1 tag |
| `npm run build` | succeeds; standalone artifact, 157 MB |
| `curl localhost:3100` | 200, renders seeded data, `X-Robots-Tag: noindex, nofollow` present |
| `npm audit` | 0 vulnerabilities |

Not yet exercised: `test:integration` and `test:e2e` have configs but no test files — they arrive in Phase 2 alongside the behavior they verify.

### Decisions taken during implementation

- **Next 16.3.0, not 15.x.** The 15.x tree carried four high-severity advisories through `postcss` and `sharp`. No migration cost in a greenfield app. Two consequences: `next lint` no longer exists, so `lint` invokes `eslint` directly; and `eslint-config-next` v16 ships native flat configs, so `FlatCompat` is gone (it throws on a circular structure).
- **Prisma stays on 6.19.** Prisma 7 exists, but its ESM-only client and new generator are a real migration, and 6.19 carries no advisory. Revisit after the sprint. The `package.json#prisma` seed key is deprecated in favor of `prisma.config.ts`; deferred because adopting it changes `.env` auto-loading behavior and the current setup works.
- **`next dev` writes into `AGENTS.md`.** Next 16 appends a `nextjs-agent-rules` block automatically (`node_modules/next/dist/server/lib/generate-agent-files.js`) and re-adds it if removed. Committed as-is. It also means Next 16 ships its own docs at `node_modules/next/dist/docs/` — read those before writing Next code in Phase 2, since 16 diverges from most training data.
- **Local Node is x86-64 running under Rosetta 2** on Apple Silicon. Next warns about degraded performance. Not blocking; worth replacing with an arm64 build.

## Disaster-recovery backup — DONE, August 9 2026

Taken with the user's explicit approval. **The connection string never entered an agent transcript**, and per §3 of `AGENTS.md` the dump itself was never opened — only its file listing was read, to prove restorability.

| | |
| --- | --- |
| Source | Heroku app `playlistnotes`, config var `MONGODB_URI`, database `playlistnotes_prod` (Atlas, `mongodb+srv`) |
| Verified counts at dump time | **notes: 33, users: 34** — matching the expected figures exactly. Only these two collections exist. |
| Artifact | `~/playlistnotes-v1-backup/pn-v1-20260809-134256.tar.gz.enc` |
| Encryption | AES-256-CBC, PBKDF2, 600,000 iterations, passphrase held only by the user |
| SHA-256 of the plaintext archive | `91ed2d850d5915163a8a37efa4f7c3557769b7c872db069fde70cf262a9a1caf` |
| Recorded alongside | `pn-v1-20260809-134256.sha256` |
| Restore rehearsal | Decrypted stream re-hashed and **matched the recorded checksum byte-for-byte** |
| Cleanup | Plaintext archive and dump directory deleted; `~/.pn-mongo-uri` and `~/.pn-db-name` shredded |

**This file contains live Spotify access and refresh tokens.** Treat it as a credential. Do not move it into the repository. Do not open it. Do not pass it to a model.

To restore:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in pn-v1-20260809-134256.tar.gz.enc | tar -xzf -
```

Outstanding: the passphrase must live in the user's password manager, and `~/.pn-backup-pass` should then be deleted. **Without the passphrase the backup is unrecoverable.**

## Phase 2 — secure note vertical slice, August 9 2026

Complete apart from Playwright. **100 tests: 52 unit, 48 integration.**

| Piece | Where | Notes |
| --- | --- | --- |
| Link parsing | `lib/music/spotify/parse-link.ts` | The security boundary. Refuses non-Spotify hosts, look-alikes, embedded credentials, link-local and loopback addresses, and non-http schemes — before any network call is contemplated. Playlists are *recognised* so they can be refused. |
| oEmbed | `lib/music/spotify/oembed.ts` | Best-effort by construction; every failure returns `null`. Takes a kind and an id, never a URL, so it cannot be pointed at an arbitrary host. |
| Resolution | `lib/music/resolve-recording.ts` | Exact `(provider, provider_id)` only. Concurrent capture yields one recording via the unique index; merges are followed rather than returned. |
| Capture | `lib/music/capture.ts` | Ties the three together. Uses no Spotify credential of any kind. |
| Notes | `lib/notes/service.ts` | `ownerId` is always the first argument and always from the session. Scoping is in the WHERE clause, not a post-fetch check. |
| UI | `app/notes/`, `app/n/[token]/` | Capture form, note list with inline edit, share/rotate/unpublish, anonymous share page. |

### Verified anonymously, without a browser

- `GET /n/<token>` → 200, renders the note, **leaks no UUID and no owner identity**
- A bogus token → 404
- `GET /notes` signed out → lands on sign-in; the string "Your notes" appears zero times
- `X-Robots-Tag: noindex, nofollow` present on the share page

### Browser smoke test — passed, August 9 2026

Driven through the Chrome extension end to end, signed in as a real Clerk user:

| Step | Result |
| --- | --- |
| Paste a track link, empty title/artist | Live oEmbed returned "CN TOWER" **with no Spotify credentials**; title prefilled, artist requested |
| Supply the artist, save | Note saved, private by default |
| Paste a playlist link | Refused with the CSV explanation; **no collection, no items, no recording** |
| Paste `open.spotify.com.evil.com/track/…` | Refused |
| Create share link, open it | Note rendered |
| Rotate the link, revisit the old URL | **404 — rotation revokes** |

Unplanned confirmation: after the capture, `recordings` stayed at 4. The browser
capture of CN TOWER matched the **seeded** recording by exact Spotify ID rather
than duplicating it — the deduplication property, demonstrated with real data.

**One bug found only by using it.** `artistDisplay` came solely from the user's
fallback while oEmbed has no artist field, so an empty first paste could never
succeed. Every test supplied an artist and shared the blind spot. Fixed, with
three regression tests.

## The premise that turned out to be wrong — August 9–10

`AGENTS.md` §4.4 held that a playlist link must create nothing, because Playlistnotes could not read a playlist's tracks without user OAuth. **That was never tested, and it was false.**

Client Credentials authenticates the *application*, so the five-user Development Mode cap never engages. Measured against the live API:

| Input | Result |
| --- | --- |
| Track | full metadata incl. artist IDs, album ID, ISRC |
| Album / EP / single | full ordered tracklist (21/21) |
| **User-created public playlist** | **full tracklist** — verified on three, owned by three different people (4, 42, 50 tracks) |
| Spotify editorial (`37i9…`) | 404, withdrawn from Development Mode |
| Private playlist | 404, genuinely needs user OAuth |

Samah questioned the premise twice before it was tested. The result is the largest feature in the product: **paste a track, album, EP, single or public playlist — from a full or short link — and it lands correctly, with no OAuth anywhere.** That restores what v1 actually did, which is what makes the name true again.

CSV import is now the *fallback* for the two cases that genuinely fail, not the primary path.

### Verified end to end in a real browser — August 10

Samah's own playlist, pasted into the live app:

```
aug23 | 1 | Dedicada a ela    | Arthur Verocai
aug23 | 2 | Na boca do sol    | Arthur Verocai
aug23 | 3 | Orris Root Powder | MF DOOM
aug23 | 4 | Nardis            | Bill Evans Trio
```

Every artist linked from its Spotify ID, order preserved, snapshot recorded.

### Bugs found only by using it, not by testing it

- **The happy path was unreachable.** `artistDisplay` came solely from the user's fallback while oEmbed has no artist field, so an empty first paste could never succeed. Every test supplied an artist and shared the blind spot.
- **A repeat paste hit the network.** oEmbed was called before the database was consulted. Now reversed, with a test that counts provider calls.
- **A timezone bug** filed session-lapse events under the previous day west of UTC.

### Process corrections — August 10

- **`.githooks/pre-push`** runs typecheck, lint, unit and integration tests and blocks the push on failure. Enable per clone with `git config core.hooksPath .githooks`. It exists because a push went out with a failing test after a shell chain used `;` instead of `&&`. Proven to fail closed.
- **No `Co-Authored-By` trailers.** Commits name Samah alone; the history was rewritten to remove 26 of them.

### Still to do in Phase 2

Playwright happy path and privacy path. Clerk needs testing tokens for automated sign-in, so this is the one part that needs setup rather than just writing.

## First droplet deployment — running, August 10 2026

The app runs on the droplet at `127.0.0.1:3001` under pm2 `playlistnotes`,
behind its own nginx vhost, against a droplet-local PostgreSQL. MKDb was not
touched: its vhost, certificate, database, and port 3000 are unchanged and
verified healthy (`https://mkdb.co → 200`) after every step.

- Node 24.9.0 installed isolated at `/opt/node24`; the system Node stays 18.19.1 for MKDb.
- Role and database `playlistnotes`; all migrations applied via `prisma migrate deploy` — 17 tables.
- `.env` written 0600, piped from the local file over ssh so no secret was ever displayed.
- Artifact built locally and rsynced to `/srv/playlistnotes/current`.
- nginx vhost from `deploy/nginx/v2.playlistnotes.io.conf`, enabled and reloaded.
- Memory after deployment: 1.2 Gi available of 1.9 Gi, all three pm2 processes online.

### The bug that made the first deployment look like a database failure

Every route that rendered hung for 30 seconds and returned 500 with
`Failed to proxy http://localhost:3001/ … socket hang up`, while routes the
proxy short-circuits redirected instantly. Prisma was verified working directly
on the box, which ruled out the obvious explanation and left a confusing one.

Next builds a per-request `initUrl` from the hostname it was started with, but
`next/dist/server/web/next-url.js` normalises **any** loopback hostname —
`127.0.0.1` included — to the literal string `localhost` when constructing the
URL that proxy code sees. Clerk's middleware sets `x-middleware-rewrite` to that
URL on every request it decorates. Next relativises the rewrite against
`initUrl`; started with `HOSTNAME=127.0.0.1` the two origins disagree, so Next
classifies its own rewrite as external and proxies the request to itself.

It reproduced identically on a laptop from the same artifact, which is what made
it tractable — it was never a droplet problem.

**`scripts/start-standalone.cjs` is now the production entry point** and owns
both halves of the fix: `HOSTNAME=localhost` so the origins match, and
`ipv4first` DNS so the socket still binds IPv4 `127.0.0.1` for nginx. They live
in a committed file rather than a pm2 flag because a pm2 flag is exactly how the
invariant would be lost on the next restart.

### Why the whole test suite was blind to it

172 tests passed, `next build` succeeded, and the process logged `Ready`. Nothing
that runs before a server boots can see this class of bug. `scripts/smoke.js`
makes real anonymous requests to the built artifact — public pages render with a
body, a protected route redirects, health reports the database — and CI now runs
it against the package it is about to upload. It was verified to fail, non-zero,
on exactly this regression before being trusted.

One thing it must not do is send `Accept: text/html`: a Clerk **development**
instance answers document requests carrying no dev-browser cookie with a
handshake redirect, which is correct behaviour but would mask whether the page
renders, and points at Clerk's domain.

Also added: the `/api/health` route the proxy already whitelisted but which had
never been written, and `prisma/` inside the artifact so the droplet can run
`migrate deploy` without a checkout.

## Not yet done — blocked on the user

| Blocked item | Needs |
| --- | --- |
| **TLS for `v2.playlistnotes.io`** | **A GoDaddy A record → the droplet.** The vhost is installed and serving; certbot's HTTP-01 challenge cannot run until the name resolves. This is the only thing between here and a gated HTTPS staging host. |
| Sanitized migration export | Only needed when legacy import is promoted into scope (post-core). `notes` in full plus `users` projected to `{user, lastModified}`. |
| **Managed PostgreSQL** | ~$15–24/mo. The droplet-local database is fine for gated staging; Managed PG is required before real users. |
| **Apple Music playlists** | Release blocker. Needs an Apple Developer account (~$99/yr); tracks and albums need nothing. |
| v1 screenshots | A browser session |
| Branch protection on `main`; tag `v1-final` | Explicit approval — the only remote is `github` and `main` auto-deploys |
| Sentry / PostHog | Accounts to be created |

## Risks

- **`main` auto-deploys to Heroku.** Any push there triggers a build. It would likely fail on EOL Node 18 and Heroku would keep the last successful release, so the blast radius is a broken build rather than an outage — but never push there.
- **Droplet memory.** 2 GB shared with MKDb and its local PostgreSQL. This is why builds happen in CI. Verify headroom after the first deployment.
- **Managed PostgreSQL + Prisma.** If DO's PgBouncer pool is used, migrations need `DIRECT_URL`; a transaction-mode pooler will break `migrate deploy`.
- **Apex DNS at cutover.** GoDaddy has no ALIAS/ANAME record, so the apex is probably using domain forwarding to `www`. Verify in the panel before moving traffic.

## Next vertical slice

Replace `/` — it is still the Checkpoint 1a schema inspector, a development tool
standing where the landing page belongs — and wire album/playlist import and
Apple capture into the capture UI. Neither needs anything from the user.
