# Migration status

Durable handoff between sessions. Read this before relying on chat context. Update it after every phase and before ending a substantial session.

**Last updated:** August 12, 2026
**Current phase:** Phases 2, 3 and 4 complete. Live over HTTPS at https://trackjot.com, gated and `noindex`. Every core capability now has a surface.
**Checkpoint 1a: PASSED.** The schema review produced two corrections, both now merged — `album_artists` was built, and the `Provider` enum was cut back to authoritative sources.
**Next milestone:** the Clerk → SuperTokens migration, which is the last piece of scope with a design decision left in it. Everything after it is verification and polish.

**Progress: roughly 97%.** Estimated 2–4 hours remain to a public release, and none of it is on the critical path for a tester actually using the product.

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
twice. One caveat, stated more carefully than it was at first: Apple's "Hide My Email"
relay address cannot match a Google or email identity, so Clerk will not link it
and the user gets a second account. That was originally written up as the same
failure that ruled out SuperTokens, which overstated it — SuperTokens split
*every* multi-method user silently and with no user action, whereas this splits
only users who deliberately chose to hide their address, with the cause legible
in the choice they just made. It is a support question to watch for during the
tester round, not a design flaw.

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

### Account linking, validated in production rather than argued

The first real sign-up exercised the exact scenario that decided Clerk over
SuperTokens: signed up with an email code, signed out, signed back in with
Google on the same address. Clerk linked them, and **the database holds exactly
one `users` row**.

That is the whole case, demonstrated. Under SuperTokens without the $100/month
account-linking feature those would have been two identities, and with
`users.auth_subject` unique, two TrackJot accounts and a journal split in half.

It also confirms the lazy `ON CONFLICT (auth_subject)` upsert behaves: one
verified subject, one local row, created on first authenticated request.

**The production database is no longer empty.** Reasoning that treated a
recreate-from-scratch as free — which is what made the rename and the database
rename cheap — no longer applies.

### A mismatch window that is worth knowing about

Between deploying the live-keyed bundle and updating `.env`, the server logged
*"instance keys do not match"* — correctly, because for those seconds the
compiled publishable key and the runtime secret genuinely belonged to different
instances. Zero occurrences after the secret landed. A key swap has an
unavoidable ordering gap; on a host with real traffic it would be worth
sequencing deliberately rather than discovering.

## Sign in with Apple — live, 2026-08-13

Three sign-in methods now: email code, Google, and Apple. Verified through a
real browser rather than assumed — the Apple button renders beside Google, and
clicking it reaches `appleid.apple.com` with:

    client_id     HHDCP3JTWP-com.trackjot.app
    redirect_uri  https://clerk.trackjot.com/v1/oauth_callback
    scope         name email

Apple then renders its own prompt reading *"Use your Apple Account to sign in to
TrackJot"*, which is the conclusive check: Apple matched the Services ID,
accepted the redirect URI, and resolved the app name. An unregistered client or
a mismatched redirect would have produced an error page at the same host, which
is why the assertion is on the page content rather than the hostname.

Two corrections to guidance given during setup:

- **The domain-association file was a false alarm.** It was raised as a possible
  blocker; `clerk.trackjot.com/.well-known/apple-developer-domain-association.txt`
  still 404s and Apple accepted the configuration anyway. It is not required for
  the web OAuth flow.
- **"Apple has no web-only path" was badly phrased** and read as though web
  sign-in were compromised. Only the *configuration* lacks a web-only route: the
  Services ID must attach to a primary App ID, which is paperwork rather than a
  commitment to ship an iOS app.

The App ID is registered as **primary**, so a future iOS share extension can be
grouped against it and keep the same Apple subject — without that, the same
person would arrive as two identities across web and app.

## The `pn` prefix — renamed 2026-08-13

The rebrand searched for "playlistnotes" and never for `pn`, so the abbreviation
survived everywhere the full name did not. Caught by review, not by a test.

| Renamed | To |
| --- | --- |
| Cookies `pn_visitor`, `pn_last_seen` | `tj_visitor`, `tj_last_seen` |
| `PN_*` backup environment variables | `TJ_*` |
| `pn-backup.sh`, `pn-restore.sh` | `tj-backup.sh`, `tj-restore.sh` |
| `/root/.pn-db-backup-pass` | `/root/.tj-db-backup-pass` — **same passphrase**, so the password-manager copy is still correct |
| `/var/lib/pn-backup`, `/var/log/pn-backup.log` | `/var/lib/tj-backup`, `/var/log/tj-backup.log` |
| rclone remote `pndrive` | `tjdrive` — a section label only; the OAuth token inside is untouched |
| New archive prefix `pn-<ts>` | `tj-<ts>` |
| e2e test email prefix | `tj_…+clerk_test@example.com` |

**Existing `pn-` archives were deliberately not renamed.** They restore fine —
`tj-restore.sh` takes an explicit path and the pruning uses `ls -t`, so a mixed
directory is harmless — and they age out within a day or a month anyway.
Verified by restoring one of each.

**The cookie rename orphans any existing breadcrumb.** With one user that is
irrelevant; the session-lapse counter simply starts again. It would have been a
real cost a month from now, which is the argument for having caught it today.

Kept, as history: `.pn-backup-pass`, `.pn-mongo-uri` and `.pn-db-name` in this
document refer to the v1 disaster-recovery artifacts and describe what was
actually done in August 2026. Same rule as the old product name.

Verified after the migration: a fresh backup ran and uploaded, a restore
rehearsal recovered the real user, an old `pn-` archive still restored, and
nothing `pn`-named remains in the scripts, cron, rclone config, dotfiles, or the
deployed bundle.

## An outage I caused, 2026-08-13

`/invite` returned 500 to every browser for roughly twenty minutes. Found while
investigating what looked like a test regression — the browser suite dropped from
18 passing to 5.

**Cause: I walked into the trap I had documented three days earlier.** The
publishable key is compiled into the bundle at build time. Several rebuilds
during the `pn` rename ran `source .env`, which holds the **development**
publishable key, while the droplet's `.env` held the **live** secret. Clerk
requires a matched pair; mismatched, it issues a handshake the client can never
satisfy and the server 500s.

**Why nothing caught it.** `/api/health` passed — it checks the database.
The smoke check passed — it makes requests without an HTML `Accept` header, so it
never triggers the handshake. `pm2` reported online. Every signal that exists was
green while the product was unusable in a browser. That is the same shape as the
proxy-loop bug on 2026-08-10: the failure lives in a seam no health check looks
at.

**The fix, and the guard.** Rebuilt with the live key and redeployed.
`check-env.mjs` now greps the publishable key actually present in `.next/static`
and compares it to `.env`, failing with an explicit REBUILD instruction. Verified
both ways: exit 1 against a deliberately mismatched build, exit 0 against the
repaired one.

**A second bug, found underneath the first.** The Playwright suite had been
masking this. `playwright.config.ts` decided whether to apply the saved storage
state with `existsSync(...)`, evaluated at *config load* — before global setup
writes the file. So it was really asking whether a previous run had left one:
delete it and the invite cookie silently stops being applied; keep it and a stale
session leaks between runs. The saved state had in fact been poisoned with
development Clerk cookies and a redirect counter from the mismatch window.

Three corrections: the config now points at the path unconditionally and global
setup guarantees the file exists on every path; `clerkSetup` runs only against a
local target, because pointing development interception at a production host is
itself a handshake loop; and a gate that cannot be passed now throws instead of
warning, since thirteen specs failing on their own assertions reads exactly like
a broken application.

## Product pass after first real use — 2026-08-14

Samah used the deployed app properly for the first time and the feedback was
mostly about **shape**, not bugs. Almost every item traced back to the same
root: the app had been built as a set of correct operations rather than as a
sequence a person moves through. This pass fixes that.

### Capture now reads before it writes

The single box asked for a note *before* it knew what had been pasted. A
playlist link therefore offered a note box that could never be saved, and a
track link asked for a title the provider was about to supply anyway.

Capture is now two deliberate steps, split across `lib/music/preview-link.ts`
(side-effect-free resolution) and `app/notes/capture-actions.ts` (the writes):

- **Look up** — `previewLink()` says what a link is and **creates nothing**. It
  keeps the database-first ordering, so a recording already held is answered
  with zero provider calls however many times it is pasted, and a user who
  pastes a link and walks away leaves no row behind.
- **Then write** — a *track* preview shows its cover, title, artist and album
  and only then offers a note box. A *collection* preview shows its cover and
  offers to be added, with **no note box at all**.

Two pills replace the mixed form: **Paste a link** (preferred) and **Type it
in**. Title and artist fields exist only in the manual tab, so it is never
ambiguous which input wins.

The save path re-resolves the recording from the provider ID via the new
`captureFromProviderRef()` rather than trusting hidden fields, so a tampered
form can at worst name a different real track.

### Collection-level notes

`notes.recording_id` is now nullable and `notes.collection_id` exists, with two
CHECK constraints written by hand (Prisma cannot express them):

- `notes_exactly_one_subject` — `num_nonnulls(recording_id, collection_id) = 1`
- `notes_context_requires_recording` — a `collection_item_id` requires a recording

This is §3a's "honest form of collection-level journaling", which the plan
deferred rather than rejected. `searchNotes` was switched to LEFT JOINs against
both subjects; an inner join on `recordings` would have made every
collection-level note silently unfindable, which is the one promise the product
makes.

### Cover art, stored as links

`lib/music/artwork.ts` normalises what the providers hand back — Spotify returns
fixed renditions (640/300/64) while Apple returns a `{w}x{h}` template, so we
ask Apple for exactly the sizes we render. Two sizes are stored per album,
recording and collection: full for a page hero, thumb for list rows.

**Still links, never bytes** (AGENTS.md's "linked, never rehosted"). That also
answers the capacity question: artwork adds effectively **zero** disk. The
droplet is at 16G of 48G used, 32G free, 1.1Gi RAM available; the whole trackjot
database is 8983 kB.

`components/cover-art.tsx` renders a plain `<img>` rather than `next/image`, on
purpose: the optimizer would fetch, re-encode and cache every provider image on
a 2 GB box that also runs MKDb's PostgreSQL — rehosting by another name. It
applies a host allowlist (`safeArtwork`) at one place, so no page can turn an
attacker-supplied URL into a tracking beacon, and sends no referrer.

### Sharing is one question with three answers

"Create share link", "Make private" and "Rotate link" asked users to reason
about token lifecycles. People hold this as an **audience**, so it is now one
select: private / unlisted / public.

**Rotation is gone deliberately.** It was never a distinct intent — its real use
("this link got out") is *going private*, which clears the token; sharing again
mints a new one. Same guarantee, one concept. The test that proved rotation
revoked a leaked link was replaced by one proving the private-then-share cycle
does, rather than deleted.

### The rest of the pass

| Gap | Now |
| --- | --- |
| No navigation anywhere; a bare "Sign in" in the landing footer under two sign-in buttons; signing in landed on `/account` | `components/site-nav.tsx` on every page, `components/site-footer.tsx` with no auth link, and `signInFallbackRedirectUrl="/notes"` set on `ClerkProvider` rather than in `NEXT_PUBLIC_*` — one fewer value that has to match across the build boundary |
| No About page | `/about`, public, stating plainly who can see a note and what happens to it |
| Every note rendered as an open textarea | Read-only until **Edit**, with "Written 3 Aug · edited 14 Aug" from `lib/format-date.ts` (fixed locale and UTC, so server and client agree and hydration does not swap the text) |
| Tags could be typed and removed, never renamed or deleted | `renameTag` (renaming onto an existing name **merges**, in one transaction) and `deleteTag` (keeps the notes), surfaced on the filtered tag |
| No tag completion | `app/notes/tag-input.tsx` completes the token under the cursor. A `<datalist>` was tried first and is wrong: it matches the whole field, so it stops suggesting after the first comma |
| Collections could not be renamed or deleted | Both, with delete stating what survives — track notes keep their writing via `ON DELETE SET NULL`; a note about the collection itself goes with it |
| Fifty-track playlists wrapped four lines per row on a phone | `app/collections/[id]/track-row.tsx` — inline on desktop (number, cover, title, artist, album), and on a narrow screen the album and note controls move behind one button that opens a bottom sheet. **Rendered once**, positioned by CSS, so there is never a second copy of an open textarea |

### Validation — run 2026-08-14, all green

```
npm run typecheck                        clean
npm run lint                             clean
npm test                                 134 passed
npm run test:integration                 157 passed  (+19 new)
npm run test:e2e                         30 passed  (+2 new, 0 skipped)
npm run build                            succeeded
```

New integration coverage: `collection-management.test.ts` (10) proves deleting a
collection keeps track notes and drops only the collection's own note, that both
CHECK constraints reject a note about two subjects or none, and cross-user
denial with **valid** UUIDs for rename and delete. `tags.test.ts` gained 6 cases
for rename/merge/delete including "cannot touch another user's identically named
tag". `search.test.ts` gained 3 for collection-level notes, including that they
do not leak to a second user.

**One real accessibility defect was caught by the suite, not by eye:** the
"preferred" hint on the capture pill used `opacity: 0.75`, which put 11.52px
text at 3.16:1 against white — under the 4.5:1 floor. It now inherits the pill's
colour.

Nothing is committed, pushed or deployed. Local only, pending review.

## Second product pass — 2026-08-17/18

Samah reviewed the first pass in a browser and filed nineteen items. Most were
shape rather than defect, but the first one was a real bug and led to two more
of the same family.

### The visibility control was broken in two different ways

Reported as "the dropdown snaps back to private". Reproduced in a browser and
found to be two bugs stacked:

1. **React 19 resets an uncontrolled form after a Server Action completes.** A
   `<select defaultValue>` is restored from the `selected` *attribute* React set
   at mount, which never updates — so the pill said "unlisted" while the control
   said "private", and private could then not be chosen because the control
   already claimed to be there.
2. Making it controlled fixed the display and revealed the worse one: **React
   restores a controlled input's DOM value during the change event, and the form
   serialised its FormData after that restore.** Every change after the first
   submitted the *previous* value. The UI looked right and the write did nothing.

The fix is to keep the value in React state and pass it to the Server Action as
an **argument**, never through the DOM. The form remains only as the no-JS
fallback. A third instance of the same family — client state seeded once from
props, outliving the server truth — was then found in the collection's note
picker and fixed by keying the component on the server state.

**The lesson worth keeping: a control that reflects a server value must not
carry that value across an action boundary in the DOM.**

Two further defects surfaced only because the work was driven in a real browser:

- `<SignOutButton>` with a custom `<button>` child threw
  "You've passed multiple children components" and **took down every signed-in
  page**. Clerk's control components own their trigger; ours style a wrapper.
- `refreshCollection` tried the Spotify album endpoint and fell through to the
  playlist endpoint on failure — but `fetchAlbum` *throws* on 404, so every
  playlist refresh 500'd. It now reads the kind from the stored `source_url`,
  which was captured at import for exactly this reason.
- A Server Action that threw left the refresh button reading "Checking…"
  permanently, because the busy flag was cleared on the line after the `await`.
  Now in a `finally`.

### Collections are no longer immutable snapshots

**This reverses a recorded invariant, deliberately.** The snapshot rule
protected notes absolutely by refusing to let a playlist change; playlists
change, so it solved the safety problem by declining the use case. A collection
can now be refreshed from its source, or have a CSV applied to it, with the
guarantee upheld directly instead:

- A note anchors to **(recording, occurrence)** — the nth appearance of that
  recording — so a note on the *second* copy of a repeated track follows the
  second copy however the order changes. `collection_items.occurrence` was added
  and backfilled for this.
- A note whose slot is gone is **orphaned, never deleted**: it keeps its body,
  tags and recording, and stops claiming a playlist position.
- Every refresh is **previewed before it happens**, listing in full every note
  that would come unstuck. Nothing is written until that is confirmed.
- Re-anchoring is **not** an edit, so a refresh does not make fifty notes claim
  they were rewritten today.

CSV import gained the same two modes: replace (the default — a re-export *is*
the playlist now) or append.

### Sharing selected notes with a collection

The invariant survives in a new form: publishing a collection never publishes
the notes inside it — it publishes **the ones you ticked**, and nothing is
ticked by default. `getSharedCollection` still cannot return a note; notes travel
only through a separate query gated on a per-note boolean, and turning a note
private or the collection private clears it.

### The rest

| # | Item | Outcome |
| --- | --- | --- |
| 2 | Share URL printed on screen | A copy button; the URL remains as its accessible name |
| 3 | Blurry thumbnails on a phone | Thumbs are fetched at 300px and drawn at ~48–56px (a 3x display needs ~170px); tapping any cover opens it full size in a native `<dialog>` |
| 4 | No album name on `/notes` | Shown, from the linked album or the denormalized title |
| 5 | Visibility changes bumped "edited" | It no longer does. Body and **tags** do; tags previously did not, because they live in a join table |
| 6 | UTC dates showed tomorrow | US format, `America/New_York`. A per-account time zone is owed before launch |
| 7 | No sorting | Track / artist / album / when-heard / recently-written, each direction, all in the URL |
| 11 | "Open the original" | "Open in Spotify" / "Open in Apple Music" |
| 13 | — | Optional **"heard on"** date at day, month or year precision — the stored timestamp anchors the range and the precision decides rendering, so a year never displays as a day |
| 14 | — | Optional **place**, coarse by default; coordinates only with a per-note opt-in, enforced by a CHECK |
| 15 | — | Filters by track, artist, album, place and heard-date range |
| 16 | — | Export as JSON, CSV or Markdown from `/account` |
| 17 | Stock `confirm()` dialogs | Native `<dialog>`, **Cancel autofocused**, and the body says what survives |
| 18 | Stacked sheets on mobile | One open row by construction; notes visible under every track at all widths; the sheet shows the cover large |
| 8 | — | Usernames: claimed on `/account`, case-folded, route names reserved. **Following and tagging other users are not built** |

### Validation — 2026-08-18

```
npm run typecheck                        clean
npm run lint                             clean
npm test                                 138 passed
npm run test:integration                 186 passed  (+29 new)
npm run build                            succeeded
```

New coverage: `collection-refresh.test.ts` (9) proves a note follows its track
across a reorder, that a note on the second copy of a repeated track follows the
second copy, that a lost slot orphans rather than deletes, and that re-anchoring
does not touch `updatedAt`. `note-journal.test.ts` (15) pins down what counts as
editing, the two new CHECK constraints, sorting and filtering, and that CSV
export survives a body containing a comma, a quote and a newline.
`collection-sharing.test.ts` gained 5 for selective sharing in both directions.

Every fix above was also exercised in a real browser against the running app.

Nothing is committed, pushed or deployed.

## Shared-note page and a revoked-link 404 — 2026-08-21

Two items from testing a live share link.

**A revoked link showed a bare framework 404.** Reported as a red overlay error
(`'SharedNotePage' cannot have a negative time stamp`) — that part is a Next.js
**dev-overlay artifact** that fires when a Server Component calls `notFound()`,
and a real production build was verified to return a clean 404 with no error.
But the underlying experience was still wrong: someone who was sent a link by a
friend met "This page could not be found", which reads as a broken product
rather than as a deliberate act. `/n/[token]` and `/c/[token]` now have their
own not-found pages saying the link isn't available and that sharing can be
taken back.

**The copy is identical whether the link was revoked or never existed.** That is
the point, not laziness: distinguishing them would make the page an oracle for
testing guessed tokens.

**A shared note now shows the cover, the album, its tags and who shared it.**
The page reads from `getSharedNoteView`, a projection whose select list is the
security boundary — a page cannot render what it was never handed. Three
deliberate omissions, asserted by test:

- **the place and the "heard on" date** — a shared note is a quotation, not a
  check-in, and location is the one field where an accidental disclosure cannot
  be taken back;
- **anything identifying beyond a chosen name** — no email, no auth subject, no
  user id; the author is a username or display name they picked, or nothing at
  all, rather than an invented identity;
- **the note's UUID, its owner's id and its share token.**

Link previews are unchanged and still generic: `generateMetadata` remains
forbidden on those routes. The guard that enforces it now strips comments before
matching, because a bare substring check made it impossible to *name* the rule in
the file it governs — which pressures the next person to delete the explanation
rather than keep the guarantee.

### Validation — 2026-08-21

```
npm run typecheck / lint                 clean
npm test                                 138 passed
npm run test:integration                 191 passed  (+5 new)
npm run test:e2e                          31 passed
npm run build                            succeeded
```

The 404 and the enriched page were both verified against a **real production
build** served from the standalone artifact, not against the dev server — the
dev overlay is exactly what made the original report ambiguous.

## Last.fm listening history — 2026-09-08

The first post-core integration (Phase F), built to the shape Samah and GPT-6
Astra converged on: **enter a username → see recent plays → choose one → write a
private jot**, with the listening instant preserved as the note's date.

### What it is allowed to be

Three lines in `AGENTS.md` decided most of the design, and each is load-bearing:

- **"Treat a Last.fm username as a source setting, not TrackJot authentication."**
  It is the name of a public feed to read. `user.getrecenttracks` needs only an
  application API key, so no user authorisation happens on Last.fm's side
  either. It is not a login, grants access to nothing, and nothing depends on
  the person who typed it owning that profile. Linking checks only that the
  profile *exists*, which catches a typo — the contract permits claiming
  verification only if the product says the profile is verified, and it does not.
- **"Do not use Last.fm as the canonical recording identity."**
- **"Do not use Last.fm-provided artwork under the ordinary API terms."** The
  `image` array is never read; a unit test asserts no Last.fm image URL can
  reach a returned object. Plays therefore show no cover, and the UI says why
  rather than looking broken.

`lastfm` remains deliberately absent from the `Provider` enum. A new
`ListenSource` enum answers the different question — *who told us this was
played* — for which listening history is a fine authority and identity is not.

### The judgement call worth knowing about

A scrobble arrives as three strings and, sometimes, a MusicBrainz id. So import
forks:

| Scrobble carries | Becomes | Why |
| --- | --- | --- |
| A recording MBID | A provider-anchored recording via the ordinary `resolveByProviderId` path | MusicBrainz is a trusted `Provider`; this is an identifier, not a name |
| No MBID | `origin = user`, scoped to its creator | Names cannot create shared entities (§3a). Two people scrobbling the same obscure song get two rows — a duplicate is cheap, a false merge is not |

**Where the residual risk sits:** the MBID is issued by an authority, but the
claim that *this play is that recording* is Last.fm's own matching, which is
imperfect. That claim is therefore also written to the `listens` row as
provenance, so anything Last.fm influenced can be found and unwound later. The
alternative — resolving by name — is the one thing the contract forbids
outright. No artist or album rows are created from Last.fm data at all; the
album title is carried as `releaseTitle`, which is display data.

### Listens are separate from recordings

`listens` is a ledger, not a mirror. A recording is "this song exists"; a listen
is "you heard it, at 7:39pm on a Tuesday". Collapsing them would make the tenth
play indistinguishable from the first, and repeated listening is exactly the
signal a music journal wants. Rows are unique on `(owner, source, source_ref)`,
so re-reading the same window updates rather than duplicating a history.

Two edge cases are handled rather than ignored:

- **A track still playing has no timestamp.** Last.fm genuinely cannot say when
  a play happened until it finishes, so `playedAt` is null and the row is *not*
  persisted — it is not yet a reported play. It is still offered for capture,
  because the moment you are hearing something is the best moment to write about
  it; capturing writes a row at that instant.
- **The completed scrobble then arrives separately.** Rather than leaving the
  imported row beside an orphan, a completed play whose normalized (artist,
  track) matches a recent now-playing capture *absorbs* it, so "how many times
  have I heard this" stays answerable.

### `DatePrecision` gained `time`

A scrobble reports the second. The existing precisions stopped at `day`, which
would have discarded the one thing a listening history is authoritative about.
The editor deliberately does **not** offer `time` — a date input collects a day,
so offering it would let someone claim a precision the form cannot express.

That created a trap worth naming: opening a scrobble-imported note in the editor
and pressing Save would have rounded a known minute down to a day. The form now
carries the stored instant and precision, and restores them when the day was not
edited.

### The notes page never waits on Last.fm

The contract forbids a request handler waiting on Last.fm. The strip is a client
component that fetches after the page renders — if Last.fm is slow or down, it
says so and nothing else on the page is affected.

### Validation — 2026-09-08

```
npm run typecheck / lint                 clean
npm test                                 154 passed  (+16 new)
npm run test:integration                 211 passed  (+20 new)
npm run build                            succeeded
```

The 16 unit tests run against the shapes this endpoint actually produces,
including the three that break naive parsers: it reports failure with **HTTP
200**, returns a **bare object instead of an array** for a single result, and
writes **empty strings** where a missing MBID belongs. The 20 integration tests
pin the resolution fork above, sync idempotency, cross-user denial with a valid
`source_ref`, and the now-playing reconciliation.

### Connecting authenticates to Last.fm — 2026-09-08, revised

The first cut read public profiles only. Samah pointed out the flaw with a
counter-example (`womenaresmarter`), and he was right: Last.fm has a **"hide
recent listening"** privacy setting, and a public read of such a profile fails.
Confirmed against the live API — it returns **HTTP 403 with `error: 17`,
"Login: User required to be logged in"**. Those users could never have imported
anything.

Connecting is now Last.fm's **web auth flow**: the user approves on Last.fm's
own site, we exchange the returned token for a session key, and reads are signed
as that account. Nothing is typed, so the connected name cannot be somebody
else's profile — it is whatever Last.fm reports back.

**This does not weaken the contract line it appears to touch.** "Treat a Last.fm
username as a source setting, not TrackJot authentication" means Last.fm must
never log anyone *into* TrackJot. TrackJot authenticating *to* Last.fm to read a
feed the user owns is the opposite direction, and no TrackJot account depends
on it.

Details worth keeping:

- **A `state` cookie guards the callback.** Without it, a crafted callback URL
  carrying an attacker's approval token could attach the attacker's Last.fm
  account to a signed-in user's TrackJot — login-CSRF — and the victim would be
  reading a stranger's history believing it was theirs. `sameSite: lax`, not
  `strict`, or the cookie would not survive Last.fm's redirect back.
- **The session key is a credential.** Never selected into a page, response or
  export; never logged; read only when signing. Stored unencrypted, on the
  reasoning that an attacker who can read the table can almost certainly read
  the `.env` holding any key — the protections that bind are the three above.
  v1's actual sin was writing tokens to a log stream, and this column is where
  that mistake is available to make again.
- **Signing degrades rather than breaks.** A server holding session keys but
  missing `LASTFM_SHARED_SECRET` reads publicly instead of failing every call.

### A bug only the live API could show

The unit tests were written believing Last.fm "reports failure with HTTP 200 and
an error code in the body". That is true of *some* failures. It uses real status
codes for others — **403** for a hidden profile, **404** for a name that does not
exist — and the client checked `response.ok` before reading the body, so both
arrived as a generic "unavailable". A hidden profile therefore looked like an
outage rather than an invitation to sign in. The body is now parsed whatever the
status, and both shapes are covered by tests.

### Validation — 2026-09-08

```
npm run typecheck / lint                 clean
npm test                                 163 passed  (+25 Last.fm unit)
npm run test:integration                 212 passed  (+21 Last.fm integration)
npm run build                            succeeded
```

Verified against the **live** API with the real key: `samah-` returns plays with
timestamps preserved and `womenaresmarter` returns `login-required`, which is the
case the approval flow exists to solve.

### Blocked on `LASTFM_SHARED_SECRET`

`LASTFM_API_KEY` is configured; **the shared secret is not**, and signing is
impossible without it. So the approval flow itself — redirect, approve, exchange,
signed read — has not been exercised end to end. It is on the same page the key
came from: <https://www.last.fm/api/accounts>.

One key and secret serve every environment: the callback is passed per request
from `APP_BASE_URL`, so localhost and production differ only in that value.

## What is left before a public release

| # | Work | Est. | Blocked? |
| --- | --- | --- | --- |
| 4 | **Screen-reader pass** over the signed-in surfaces. Axe reports zero violations everywhere including populated pages, but that is a floor. | 1 h | no |
| 5 | **Clerk Pro** — ~90-day inactivity timeout, absolute maximum disabled, passkeys once the domain is canonical. | 30 min | **at invite time** |
| 6 | **Drive backup account** — move to a TrackJot-owned Google account. | 30 min | **at invite time** |
| 7 | **Invite ~10 testers.** | — | after the above |

**Not in scope for release:** legacy import of the 33 v1 notes, Sentry/PostHog,
artist and album pages, Last.fm, and cutover of the `playlistnotes.io` apex.
