# Migration status

Durable handoff between sessions. Read this before relying on chat context. Update it after every phase and before ending a substantial session.

**Last updated:** August 7, 2026
**Current phase:** Phase 1 — foundation
**Next milestone:** Checkpoint 1a — hands-on local schema review

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
| Artists / albums | Entity tables ship now, linked from provider IDs only. No `album_artists` join table yet. |
| Clerk webhooks | Out of scope. Lazy upsert on first authenticated request. |

## Operational facts

| Fact | Value |
| --- | --- |
| Heroku app | `playlistnotes` |
| Heroku deploys | **Automatic deploys from `main` are ENABLED** — confirmed by the user, not inferred |
| DNS | GoDaddy, records currently configured for Heroku |
| Droplet | `root@68.183.29.69`, 1 vCPU / 2 GB RAM / 50 GB disk, NYC1, $12/mo (resized Aug 7 from 1 GB) |
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

1. **No server-side authorization on any note endpoint** — `routes/note.js` takes `user` from the query string. Anyone supplying a Spotify user ID can read, overwrite, or delete that user's notes. Spotify user IDs appear in public profile URLs, so this is not bounded by the five-user cap. **Known, accepted, time-boxed; closed at cutover.**
2. Access and refresh tokens are `console.log`'d — `routes/authorize.js:111,115,177,178`. Live tokens are in Heroku's log stream.
3. One module-level mutable Spotify client shared across requests — `routes/authorize.js:34`. `setAccessToken` races under concurrency.
4. The 429 handler can leave `retryIntervalID` set permanently, hard-failing every route.
5. `client_id` hardcoded at `routes/authorize.js:31` (public value, no action needed).
6. CRA deprecated; Node pinned to EOL `18.12.1` → **v1 likely no longer rebuilds on Heroku.**

## Completed

- **Phase 0.** `v2` branch created from `main` at `32d028e`. `AGENTS.md` and `CLAUDE.md` reconciled with all decisions above and committed. Report archived to `docs/v2-plan/` as non-normative with a divergence table. This file created.

## Not yet done — blocked on the user

| Blocked item | Needs |
| --- | --- |
| DR MongoDB backup | The user runs `mongodump` themselves; the connection string must never enter an agent transcript |
| Sanitized migration export | Follows the DR backup |
| v1 screenshots | A browser session |
| Push `v2`; branch protection on `main`; tag `v1-final` | Explicit approval — the only remote is `github` and `main` auto-deploys |
| Clerk / Sentry / PostHog | Accounts to be created |
| Managed PostgreSQL | Provisioning approval (recurring cost) |
| First deployment | SSH approval; nginx, pm2, certbot, GoDaddy A record |

## Risks

- **`main` auto-deploys to Heroku.** Any push there triggers a build. It would likely fail on EOL Node 18 and Heroku would keep the last successful release, so the blast radius is a broken build rather than an outage — but never push there.
- **Droplet memory.** 2 GB shared with MKDb and its local PostgreSQL. This is why builds happen in CI. Verify headroom after the first deployment.
- **Managed PostgreSQL + Prisma.** If DO's PgBouncer pool is used, migrations need `DIRECT_URL`; a transaction-mode pooler will break `migrate deploy`.
- **Apex DNS at cutover.** GoDaddy has no ALIAS/ANAME record, so the apex is probably using domain forwarding to `www`. Verify in the panel before moving traffic.

## Next vertical slice

Finish the Phase 1 foundation through the schema and seed, then **stop at Checkpoint 1a** so the user can browse the seeded model in Prisma Studio before any Managed PostgreSQL spend or droplet change.
