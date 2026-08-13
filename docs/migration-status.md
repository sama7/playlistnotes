# Migration status

Durable handoff between sessions. Read this before relying on chat context. Update it after every phase and before ending a substantial session.

**Last updated:** August 12, 2026
**Current phase:** Phases 2, 3 and 4 complete. Live over HTTPS at https://trackjot.com, gated and `noindex`. Every core capability now has a surface.
**Checkpoint 1a: PASSED.** The schema review produced two corrections, both now merged — `album_artists` was built, and the `Provider` enum was cut back to authoritative sources.
**Next milestone:** the Clerk → SuperTokens migration, which is the last piece of scope with a design decision left in it. Everything after it is verification and polish.

**Progress: roughly 96%.** Estimated 2–4 hours remain to a public release, and none of it is on the critical path for a tester actually using the product.

The remaining work is an auth-provider migration, the browser specs that depend
on it, and an accessibility pass. No unknowns of the kind that produced the
proxy-loop hang; nothing blocked on a credential or an account.

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
| TrackJot port | `127.0.0.1:3001`, pm2 process `trackjot`, own nginx vhost and certificate |
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

`AGENTS.md` §4.4 held that a playlist link must create nothing, because TrackJot could not read a playlist's tracks without user OAuth. **That was never tested, and it was false.**

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

The app runs on the droplet at `127.0.0.1:3001` under pm2 `trackjot`,
behind its own nginx vhost, against a droplet-local PostgreSQL. MKDb was not
touched: its vhost, certificate, database, and port 3000 are unchanged and
verified healthy (`https://mkdb.co → 200`) after every step.

- Node 24.9.0 installed isolated at `/opt/node24`; the system Node stays 18.19.1 for MKDb.
- Role and database `trackjot`; all migrations applied via `prisma migrate deploy` — 17 tables.
- `.env` written 0600, piped from the local file over ssh so no secret was ever displayed.
- Artifact built locally and rsynced to `/srv/trackjot/current`.
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

## Overnight session, August 11 2026

Everything in the core loop now has a surface. What was added, and why each
decision went the way it did:

### Collections you can actually annotate

The collection page was a track listing you could read but not write to, which
left `notes.collection_item_id` unreachable — the column exists because "this
song, third into this playlist" is a different statement from "this song", and
annotating a playlist track by track is what v1 was actually for.

The action accepts a collection item id and a body and **nothing else**; the
recording is resolved from the item server-side. A client able to name both
could pair someone else's item with an arbitrary recording, and validating that
pair afterwards is a weaker position than never accepting it.

### Sharing that cannot leak a note

Collections get unlisted links with the same rotatable-token model as notes.
The invariant is structural: `getSharedCollection` selects a narrow shape that
does not include the notes relation **at all**, so there is nothing on the
shared page to accidentally render. The tests search the serialised payload for
the note's text rather than asserting on shape, so an `include` added later
fails there instead of shipping.

The share panel states the guarantee next to the button, with the count of notes
that will stay private — publishing is a decision people make quickly and regret
slowly, and an annotated collection *looks* like sharing it might share the
annotations.

### Search and tags

Search is a plain GET form, so a search is linkable and survives a reload.
Tags are unique per `(owner_id, name)` rather than globally: a shared vocabulary
would expose one person's labels to another the moment autocomplete existed.
The tag field replaces rather than merges, and orphaned tags are swept — with a
test proving one user's sweep cannot delete another user's identically named tag.

### CSV import

Written, not installed: the format's hard parts are ~60 lines and the input is a
file a stranger uploads, so a dependency would have meant auditing someone
else's parser against hostile input anyway.

Entities come from URI columns because `Artist URI(s)` splits on commas
unambiguously and `Artist Name(s)` does not — **"Tyler, The Creator"** is one
artist whose name contains a comma. A repeat upload is recognised by content
hash and offered as a choice rather than blocked, and duplicate detection is
owner-scoped because two people importing the same public export is two people.

### Apple Music, actually working

The Developer account was set up days ago; what was broken was **my** copy of the
key. The first deployment used `grep`, which is line-based, so the multi-line PEM
arrived truncated — 94 of 261 bytes, begin marker, no end marker. Nothing
complained because the failure only surfaces inside a signing call no anonymous
request makes.

Repaired and verified against the live API. A catalog playlist returned 50
tracks, **every one** carrying artist relationships and an ISRC, with
collaborations split into separate entities ("KAROL G & Bruno Mars" arriving as
two artists with their own ids). Notably **Apple serves its editorial playlists,
which Spotify withholds from Development Mode apps** — the reverse of the
asymmetry that shaped the Spotify work.

`scripts/check-env.mjs` now asserts the *shape* of every configured secret
without printing a value, and was verified to exit 1 naming the right variable
against the broken file kept as a backup.

### Backups, end to end

Off-host copies are live on the `trackjotapp@gmail.com` Drive, using their
own Google OAuth client rather than rclone's shared one (which rclone warns is
being retired during 2026) and `drive.file` scope rather than full `drive`.

The whole chain was rehearsed, not just the upload: a probe row written to the
live database, backed up, encrypted, uploaded, downloaded into a directory
holding no other copy, decrypted, and restored — probe row present, 17 tables.

**Test totals: 300.** 134 unit, 137 integration, 29 Playwright.

### Two pre-existing defects found by an outside audit, 2026-08-12

**The contract contradicted the implementation.** `AGENTS.md` §4.4 and the
matching line in `CLAUDE.md` still carried the original "a playlist link never
creates a collection" rule, while §11 recorded its reversal and the code, tests
and README all implemented the reversal. `AGENTS.md` declares itself
authoritative, so a future agent reading §4.4 could have obeyed the obsolete
rule and removed working behaviour. Both are now rewritten to state the surviving
invariant — a collection comes from an enumerated tracklist or an uploaded file,
never inferred from a link — with the reversal flagged inline.

**The invite gate does not exist.** `.env.example` declares
`REQUIRE_INVITE_CODE` and `INVITE_CODE`; no source file reads either. `noindex`
keeps the host out of search results and is not access control — anyone with the
URL can sign up right now. The variables are now marked NOT IMPLEMENTED, and a
real gate is a prerequisite before the host is called invite-only anywhere that
matters.

## Not yet done — blocked on the user

| Blocked item | Needs |
| --- | --- |
| *(nothing blocking — see below)* | Both backup items and the Apple Developer account were closed on August 11. |
| Sanitized migration export | Only needed when legacy import is promoted into scope (post-core). `notes` in full plus `users` projected to `{user, lastModified}`. |
| v1 screenshots | A browser session |
| Branch protection on `main`; tag `v1-final` | Explicit approval — the only remote is `github` and `main` auto-deploys |
| Sentry / PostHog | Accounts to be created |

## Risks

- **`main` auto-deploys to Heroku.** Any push there triggers a build. It would likely fail on EOL Node 18 and Heroku would keep the last successful release, so the blast radius is a broken build rather than an outage — but never push there.
- **Droplet memory.** 2 GB shared with MKDb and its local PostgreSQL. This is why builds happen in CI. Verify headroom after the first deployment.
- **The droplet is a single point of failure.** With Managed PostgreSQL rejected on cost, the database lives on the same 2 GB box as MKDb and the app. Losing the droplet loses everything not yet pushed off-host, which is exactly why the hourly encrypted backup job is a pre-invite requirement rather than a nicety. If Managed PostgreSQL is ever adopted, note that Prisma then needs `DATABASE_URL` (pooled) **and** `DIRECT_URL` (direct) — a transaction-mode pooler breaks `migrate deploy`.
- **Apex DNS at cutover.** GoDaddy has no ALIAS/ANAME record, so the apex is probably using domain forwarding to `www`. Verify in the panel before moving traffic.

## Rebrand to TrackJot — 2026-08-12

**The old name had become architecturally false.** "Playlistnotes" names a
container inside one provider, which is precisely the dependency v2 was built to
remove — and it mis-describes the data model, since notes attach to *recordings*
with playlist context as an optional foreign key. Every telling of the project's
story would have had to open by explaining why the name was wrong.

Done in one pass, while production held **0 users and 0 notes** — the cheapest
this would ever be, and the argument for doing it now rather than "after launch".

| Renamed | Kept deliberately |
| --- | --- |
| All user-facing strings, page title, share-page attribution | Every historical statement about v1: the Heroku app, its MongoDB, `sama7/playlistnotes`, the grandfathered cohort |
| npm package and lock file | Prisma migration history |
| Outbound Spotify user agent → `TrackJot/2.0 (+https://trackjot.com)` | The archived v2-plan report, a dated artefact |
| PostgreSQL role and database → `trackjot` | The Drive backup account and rclone remote name |
| pm2 process, `/srv/trackjot`, `/var/backups/trackjot`, cron file | `v2.playlistnotes.io` until the domain cutover |
| Drive backup path → `trackjot-backups` | `PN_*` operational variable names |

The rename script guarded historical lines by pattern, and two things still
slipped through and were caught by reading the diff rather than by the guard:
it rewrote **v1's own `config.env`** (`DEV_DB_NAME`, which would have broken v1
had it been run) and one multi-line comment where the sentence naming v1 sat on
the line above the sentence naming the product. Both restored. A line-based
guard cannot see a paragraph.

`app/brand.test.ts` now asserts the new name on every rendering surface, the
document title, the share attribution, the user agent, and the package name — so
a partial rebrand fails a test instead of being discovered months later on a
route nobody visits.

**Infrastructure retired, not orphaned:** a final encrypted dump of the old
database was taken before dropping it, the role and `/srv/playlistnotes` removed,
and the old backup directory deleted. MKDb verified healthy at every step.

**Sign in with Apple** is available (the Developer account exists, and Clerk
Hobby allows three social connections). Deliberately not enabled yet: it binds to
a verified domain, so doing it before `trackjot.com` is canonical means doing it
twice. It also carries a real caveat — Apple's "Hide My Email" relay address will
not match a user's Google or email identity, so Clerk cannot auto-link it, which
is the same split-account failure that ruled out SuperTokens.

## August 12 — invite gate, launch surfaces, and the rebrand's loose ends

### The invite gate now exists

It had been claimed in the docs for weeks and implemented nowhere. It runs
**before** authentication, so an uninvited visitor never reaches a sign-up form
rather than being told the site is private after making an account. Share links,
health, and the machine-readable surfaces bypass it — it stops account creation,
not content an owner deliberately published.

The cookie holds a keyed digest rather than the code, which is what makes
rotation meaningful; a test asserts an old cookie stops working once the code
changes. A misconfiguration (gate on, code empty) fails **open** by design, since
refusing to boot would take the site down over a doormat — but never silently:
`check-env.mjs` fails the deploy check on it.

**Live on staging.** The code is `jot-2026-preview`, in `.env` on the droplet.

Found by exercising it rather than reading it: `/invite` bypassed the gate but
was not a public route, so Clerk's guard redirected it to sign-in, which the gate
bounced back to `/invite` — a loop that would have locked out every invited user
on day one.

### Launch surfaces

`metadataBase` from runtime `APP_BASE_URL`, a title template, canonical URL,
Open Graph and Twitter cards, a generated icon and OG image, `robots.ts`,
`sitemap.ts`, and a web manifest. Indexing stays off until the domain and
redirects are verified; `ALLOW_INDEXING` is the single switch.

Two safety properties worth restating because they are easy to undo:

- **Share pages carry static, generic metadata.** A chat client fetching a
  pasted URL for a preview ignores robots directives, so anything in those
  fields is shown to every group chat the link reaches. `generateMetadata` is
  forbidden on those routes and tested for.
- **The sitemap lists no share URLs**, even public ones.

Caught on deploy: `/robots.txt`, `/sitemap.xml` and `/opengraph-image` were all
307ing to sign-in, because they have no extension or one outside the static
exclusion and so reached the auth guard.

### The browser suite runs in CI

The secret was added, so the `e2e` job exists: it downloads the artifact the
`build` job produced, migrates a disposable PostgreSQL, boots it, and runs all
29 specs against it. Verified by simulating the job locally first — 29 passed
against the packaged artifact.

Why it needed a real key rather than a placeholder, established by reproduction:
a real browser follows Clerk's development handshake, returns with a handshake
token, and the server **500s** verifying it against a fake secret. The job
refuses a `sk_live_` key outright, because the suite signs up real accounts.

`scripts/clean-test-users.mjs` deletes them afterwards, and runs even when the
suite fails, since a failed run creates accounts too. It only ever deletes
addresses containing Clerk's reserved `+clerk_test` marker and refuses a
production key with no override. Verified both ways: it removed 51 accumulated
test accounts and left the one real account untouched.

### v2.playlistnotes.io is retired

Kept as a redirect at first, on the general principle that share links are
durable. That principle did not apply: there are no users, no notes, and no
links in the wild. The vhost and certificate are deleted; the DNS record can go
whenever convenient.

### Rebrand loose ends

Repo renamed to `sama7/trackjot` by the owner; the local remote follows it. The
`trackjot.com` nginx vhost is installed and verified serving on the Host header,
with `www` 308ing to the apex. TLS waits on DNS.

**The domain cutover is complete.** The apex A record landed after ~43 minutes,
propagated to both GoDaddy nameservers and to Google and Cloudflare's resolvers,
and `www` follows it through the existing CNAME — which is why no second A
record was needed and the one that conflicted was correctly cancelled.

- Certificate issued for `trackjot.com` **and** `www.trackjot.com`, expiring
  2026-11-10 and auto-renewing.
- `APP_BASE_URL=https://trackjot.com`, so every generated share link is now
  canonical.
- HTTP 301s to HTTPS; `www` 308s to the apex; HSTS, `noindex`, `nosniff`,
  `DENY` all present on the canonical host.
- **`v2.playlistnotes.io` now 301s everything to `trackjot.com`, preserving path
  and query** — verified against `/n/<token>?x=1` and `/c/<token>?a=b&c=d`, which
  is the case that actually matters, since a share token lives in the path.

That old host is deliberately kept alive with its certificate renewing rather
than switched off. Share links are the product's one durable public artifact; if
that certificate lapses, every link created before the rename fails with a TLS
warning instead of redirecting, which is worse than no redirect at all. Its
vhost keeps an ACME challenge location above the redirect, and renewal was
dry-run verified.

Mail on `trackjot.com` is fully intact and was never touched: Microsoft 365 MX,
both DKIM selectors, SPF, `autodiscover`, and the `onmicrosoft` verification TXT.

## Clerk production instance — live, 2026-08-13

`trackjot.com` now runs on a **production** Clerk instance on its own domain.
Verified in a real browser: authentication requests go to `clerk.trackjot.com`
rather than `accounts.dev`, and the development-mode badge is gone.

All five Clerk CNAMEs resolve; the Microsoft 365 mail records were untouched
throughout. Google sign-in uses TrackJot's own OAuth credentials, since a
production instance cannot use Clerk's shared development app.

**The secret key never entered a transcript.** It was written to a local file
with `read -rs` (no echo, no shell history), piped straight into a 0600 file on
the droplet over ssh, substituted into `.env` by a script, and both copies
deleted. The publishable key was handled openly because it is public by design —
it ships inside the JavaScript bundle to every visitor.

### One real defect this caught in CI, before it caused a red build

Putting `pk_live_` into the repository variable made the build job's artifact
production-keyed. The e2e job downloaded *that* artifact and ran it with the
**development** secret — and Clerk validates that publishable and secret keys
belong to the same instance, so every signed-in spec would have failed at
sign-in, looking like broken auth code rather than a mismatched pair.

The e2e job now builds its own artifact from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY_DEV`
and refuses to start if that variable is missing or holds a live key. The trade
is explicit: e2e no longer exercises the byte-identical shipped package, but it
exercises the same source, and the smoke check in the build job still runs
against the real artifact.

### A mismatch window that is worth knowing about

Between deploying the live-keyed bundle and updating `.env`, the server logged
*"instance keys do not match"* — correctly, because for those seconds the
compiled publishable key and the runtime secret genuinely belonged to different
instances. Zero occurrences after the secret landed. A key swap has an
unavoidable ordering gap; on a host with real traffic it would be worth
sequencing deliberately rather than discovering.

## What is left before a public release

| # | Work | Est. | Blocked? |
| --- | --- | --- | --- |
| 2 | **Sign in with Apple** — Services ID and key in the Apple portal, then Clerk. Now unblocked by the canonical domain. Apple's Hide-My-Email relay will not match a Google or email identity, so Clerk cannot auto-link it. | 45 min | **needs dashboard access** |
| 4 | **Screen-reader pass** over the signed-in surfaces. Axe reports zero violations everywhere including populated pages, but that is a floor. | 1 h | no |
| 5 | **Clerk Pro** — ~90-day inactivity timeout, absolute maximum disabled, passkeys once the domain is canonical. | 30 min | **at invite time** |
| 6 | **Drive backup account** — move to a TrackJot-owned Google account. | 30 min | **at invite time** |
| 7 | **Invite ~10 testers.** | — | after the above |

**Not in scope for release:** legacy import of the 33 v1 notes, Sentry/PostHog,
artist and album pages, Last.fm, and cutover of the `playlistnotes.io` apex.
