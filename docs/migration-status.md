# Migration status

Durable handoff between sessions. Read this before relying on chat context. Update it after every phase and before ending a substantial session.

**Last updated:** August 11, 2026
**Current phase:** Phases 2 and 3 complete; deployed and serving over HTTPS at https://v2.playlistnotes.io. Phase 4 (sharing, search, polish) is next.
**Checkpoint 1a: PASSED.** The schema review produced two corrections, both now merged — `album_artists` was built, and the `Provider` enum was cut back to authoritative sources.
**Next milestone:** the collections UI — browsing an imported collection and writing a note against a track *in playlist context*, which is the thing v1 was actually for and the last core capability with no surface.

**Progress: roughly 72%.** Estimated 14–20 hours remain to a public release, or
6–9 working days at 2–3 h/day. That is past the original 15-day estimate because
album and playlist import, full Apple Music support, and the SuperTokens
migration were all added to scope after it was written.

The remaining work is unusually well understood: no unknowns of the kind that
produced the 30-second proxy hang, and every blocked item is a credential or an
account rather than a design question.

---

## Decisions already made — do not re-ask

| Question | Answer |
| --- | --- |
| Where does v2 code live? | The long-lived **`v2` branch** of `sama7/playlistnotes`. Not a new repo, not the `~/Documents` planning directory. |
| Branch strategy | `main` **frozen** (v1 production). `develop` is a stale byte-identical duplicate of `main`; leave it untouched and delete after v2 ships. All work on `v2`. Short-lived `v2/<slice>` branches with PRs only for auth and privacy diffs. |
| Staging hostname | `v2.playlistnotes.io` — gated, `noindex`, non-canonical. GoDaddy A record to the droplet. |
| Production database | **Droplet-local PostgreSQL 16 with self-built encrypted off-host backups** — reversed from the original plan. Managed PostgreSQL was rejected on cost for a product with no users yet: ~$15–24/mo buys automated backups and failover that hourly encrypted dumps to Drive provide well enough at this stage. Revisit when there is a user base whose data loss would matter more than the spend, or when the droplet's single point of failure becomes the binding risk. The migration path is a `pg_dump`/`pg_restore` away, and nothing in the schema or Prisma config depends on which one is in use. |
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
| Capture | `lib/music/capture-track.ts` | Provider-neutral. Database first, then the provider API, then oEmbed, then the user. Superseded `lib/music/capture.ts`, which was oEmbed-only. |
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

### Playwright — sequenced around the auth migration

Ten anonymous-visitor specs exist and pass against the deployed staging host
(`tests/e2e/anonymous.spec.ts`). They target exactly what unit and integration
tests could not see: a page component leaking private notes, and every rendering
route hanging behind a proxy gate that worked.

Specs that must **sign in** are deferred until after the Clerk → SuperTokens
migration. Clerk testing tokens would work today, but the auth fixture is
throwaway once the provider changes, and it is the fixture rather than the
assertions that gets rewritten.

Not wired into CI: a real browser follows Clerk's development handshake out to
accounts.dev, and CI holds only a placeholder secret, so the run would be flaky
for reasons unrelated to the app. The packaged-artifact smoke test guards CI
instead. SuperTokens removes the handshake and this can then move into CI.

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

## August 11 2026 — HTTPS, both providers, and backups

### Live and gated

`https://v2.playlistnotes.io` serves over TLS. HTTP 301s to HTTPS, HSTS is set
(without `includeSubDomains` or `preload` — both would commit an apex that is
still v1 on Heroku), `X-Robots-Tag: noindex` is present, and MKDb was verified
healthy after every step. Certificate expires 2026-11-09 and renews
automatically.

### Capture now uses the provider APIs

`fetchTrack` had been written, tested, and **never called**. Pasting a Spotify
track link still went through oEmbed, which returns a title and no artist field
at all — so every first paste of a new track stopped to ask the user to type the
artist, and the row it wrote linked nothing: no artists, no album, no ISRC. The
same song imported as part of an album got the full treatment, because
collection import had its own richer path.

The entity-linking logic moved out of `import-collection.ts` into
`persist-track.ts`, and both doors now go through it. A pasted track produces
exactly the row the album import would.

**Apple Music is wired end to end for the first time** — track capture and album
import through the public iTunes lookup, which needs no developer account.
Playlists and full artist relationships need the catalog API and its signed
token; the refusal says so rather than failing vaguely.

The independence invariant is unchanged and better tested:
`no-spotify-credentials.test.ts` now strips the optional credential for its whole
duration, so it behaves identically on a laptop that has one. It previously would
have silently changed code paths.
`no-network-on-known-track.test.ts` counts **both** provider paths, since
counting one would let the other escape the guarantee on exactly the machines
where it is active.

### Backups exist and have been restored

Dropping Managed PostgreSQL moved its automated backups onto us, and until now
nothing did that job. Hourly encrypted dumps (24 hourly + 30 daily), verified
complete rather than truncated before being kept, encrypted before anything
leaves the box, scheduled from `/etc/cron.d/` so MKDb's crontab is never opened.

**Rehearsed 2026-08-11:** a probe row was written, backed up, and recovered into
a scratch database — 17 tables, probe row present. Also verified: the ciphertext
holds no readable SQL, a wrong passphrase fails with a clear message instead of
half-restoring, and restoring over the live database is refused without an
explicit flag. `docs/runbook.md` has the procedures.

**Test totals: 191.** 93 unit, 88 integration, 10 Playwright.

## Not yet done — blocked on the user

| Blocked item | Needs |
| --- | --- |
| **Backup passphrase is single-copy** | `/root/.pn-db-backup-pass` on the droplet — the same place as the backups it decrypts. Copy it into the password manager. Without it every archive is scrap. |
| **Off-host backup copies** | An rclone remote for the `playlistnotesapp@gmail.com` Drive needs a browser OAuth grant. Until it exists, backups survive a bad migration but not a lost droplet, and the script warns on every run. |
| Sanitized migration export | Only needed when legacy import is promoted into scope (post-core). `notes` in full plus `users` projected to `{user, lastModified}`. |
| **Apple Music playlists** | Release blocker. Needs an Apple Developer account (~$99/yr); tracks and albums need nothing. |
| v1 screenshots | A browser session |
| Branch protection on `main`; tag `v1-final` | Explicit approval — the only remote is `github` and `main` auto-deploys |
| Sentry / PostHog | Accounts to be created |

## Risks

- **`main` auto-deploys to Heroku.** Any push there triggers a build. It would likely fail on EOL Node 18 and Heroku would keep the last successful release, so the blast radius is a broken build rather than an outage — but never push there.
- **Droplet memory.** 2 GB shared with MKDb and its local PostgreSQL. This is why builds happen in CI. Verify headroom after the first deployment.
- **The droplet is a single point of failure.** With Managed PostgreSQL rejected on cost, the database lives on the same 2 GB box as MKDb and the app. Losing the droplet loses everything not yet pushed off-host, which is exactly why the hourly encrypted backup job is a pre-invite requirement rather than a nicety. If Managed PostgreSQL is ever adopted, note that Prisma then needs `DATABASE_URL` (pooled) **and** `DIRECT_URL` (direct) — a transaction-mode pooler breaks `migrate deploy`.
- **Apex DNS at cutover.** GoDaddy has no ALIAS/ANAME record, so the apex is probably using domain forwarding to `www`. Verify in the panel before moving traffic.

## What is left before a public release

| # | Work | Est. | Blocked? |
| --- | --- | --- | --- |
| 1 | **Collections UI** — browse an imported collection, and write a note against a track *in playlist context*. The domain layer and schema (`collection_items`, `notes.collection_item_id`) are done; there is no surface. This is what v1 was actually for. | 3–4 h | no |
| 2 | **Sharing** — unlisted/public visibility for collections, with a "what viewers see" preview. Notes already have it. Must prove publishing a collection never publishes the private notes inside it. | 2–3 h | no |
| 3 | **User-scoped note search** — `lib/notes/search.ts` exists and is weighted and owner-scoped; it has no UI. | 1–2 h | no |
| 4 | **Clerk → SuperTokens** — 7-day non-sliding sessions plus passkeys. Touches `lib/auth.ts`, `proxy.ts`, the sign-in/up routes, and the `users.auth_subject` upsert. Everything downstream is provider-agnostic already. | 3–5 h | no |
| 5 | **Signed-in Playwright specs** — happy path and cross-user privacy, after (4). Then move the whole suite into CI, which the Clerk handshake currently makes flaky. | 1–2 h | after (4) |
| 6 | **CSV import** — Exportify-compatible. Kept in scope deliberately. Value is lower than it was: link import now covers albums and public playlists, so this is for private and editorial playlists, which genuinely cannot be read any other way. | 2–3 h | no |
| 7 | **Tags** — schema exists, no UI. | 1 h | no |
| 8 | **Responsive and accessibility pass**, then invite ~10 testers. | 1–2 h | no |

**Not required for release:** Apple Music playlists (needs an Apple Developer
account), legacy import of the 33 v1 notes, Sentry/PostHog, artist and album
pages, Last.fm.

**Required before real users write anything they would miss:** the backup
passphrase copied off the droplet, and the rclone Drive remote authorised. Both
are in the blocked table above.
