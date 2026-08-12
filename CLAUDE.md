# TrackJot v2 - Claude Code Guide

Read `AGENTS.md` completely before acting. `AGENTS.md` is the authoritative, model-agnostic implementation contract. This file tells Claude Code how to execute that contract efficiently and safely; it does not replace or weaken any requirement in `AGENTS.md`.

## Objective

Build TrackJot v2 as a secure, provider-independent music journal:

- TrackJot-owned accounts, not Spotify identity
- first-class private notes and collections
- deliberate unlisted/public sharing
- internal UUIDs for recordings and mappings to provider IDs
- Spotify track-link capture without Spotify OAuth
- Exportify-compatible CSV collection import
- Last.fm recent-listen capture after the core workflow
- PostgreSQL as the system of record

The rescue sprint succeeds when new users can sign in without Spotify, create a private track note, import a collection snapshot, share selected content, and return later to create another note.

This change is necessary because Spotify Development Mode permits only five allowlisted authenticated Spotify users per app. Playlistnotes v1 holds **20 grandfathered users** added when the cap was higher; that cohort is a test asset, not a growth path, because no further users can be added. Spotify's July 2026 increase to 25 Client IDs changed the number of app identifiers, not the five-user allowance, and those apps share one developer-account quota. Extended Quota remains possible for approved organizations, but its current published threshold includes a launched service and at least 250,000 MAU. V2 must therefore grow without Spotify OAuth.

## First actions in every session

1. Read all of `AGENTS.md`.
2. Inspect the current repository status and any instruction files that apply.
3. Preserve user-authored or unrelated changes.
4. Determine the current rescue-sprint phase and its exit criteria.
5. Read or create `docs/migration-status.md` and reconcile it with the repository before relying on prior chat context.
6. State a concise plan and keep only one step in progress.
7. Work on the smallest complete vertical slice.
8. Validate before reporting completion and update the migration status file.

**Repository location is decided.** v2 lives on the long-lived `v2` branch of `sama7/playlistnotes`. Do not ask again; the decision and its rationale are recorded in `docs/migration-status.md`.

`main` is frozen: it has **confirmed automatic Heroku deploys** for the app `playlistnotes`, and v1 pins EOL Node `18.12.1`, so a push there triggers a build that will likely fail. Never push or merge to `main` without explicit cutover approval. The only remote is named `github` — there is no `origin`.

## Locked technical direction

Use these defaults unless the user explicitly decides otherwise:

- Next.js App Router, React, strict TypeScript, `output: 'standalone'`
- Node.js 24 LTS, pinned via `.nvmrc` and `engines`
- PostgreSQL 16+; npm as the package manager
- Prisma migrations and queries, `binaryTargets = ["native", "debian-openssl-3.0.x"]`
- Clerk email one-time code plus Google login, **no webhooks** — lazy user upsert via `ON CONFLICT (auth_subject)`
- Zod validation
- Vitest/Testing Library and Playwright
- `/api/v1` bounded to core native-relevant endpoints; broad OpenAPI is post-core
- GitHub Actions CI, which also **builds the deployable artifact** — the droplet only runs it
- DigitalOcean droplet at `127.0.0.1:3001` under pm2 `trackjot`, alongside but never touching MKDb on port 3000; **droplet-local PostgreSQL 16 with self-built encrypted off-host backups** — Managed PostgreSQL was considered and rejected on cost for a product with no users yet
- Sentry and PostHog only when credentials are supplied

Do not introduce React Native, E2EE, billing, collaboration, microservices, Kubernetes, or automatic Spotify synchronization during the rescue sprint. Artist and track pages, collaborative collections, album pages, and cross-provider enrichment are **wanted but deferred** — see the recorded backlog in `AGENTS.md` §16.

## Non-negotiable Spotify boundary

The five-user cap applies to Spotify-authenticated users, not TrackJot accounts or public links/Embeds. Implement the following capability boundary exactly:

- Spotify track URL/URI: resolve/create a TrackJot recording and allow a note without Spotify OAuth. Basic Embed metadata is best-effort; minimal user-supplied metadata is the fallback.
- Public Spotify playlist URL: **imports the collection** (reversed 2026-08-10 — Client Credentials enumerates user-created public playlists without any user OAuth). A playlist that genuinely cannot be enumerated — Spotify's own editorial playlists, or anything private — creates **nothing**, and says why, offering CSV import. Apple Music serves its editorial playlists and needs a developer token for playlists at all. The invariant that survives: a collection is created only from an enumerated tracklist or an uploaded file, never inferred from a link alone.
- Playlist contents: accept an Exportify-compatible or neutral user-supplied CSV as an ordered snapshot.
- Spotify albums/artists: defer first-class capture until the core track workflow is proven.
- Spotify library/private playlists: unsupported in the rescue sprint.

The core acceptance suite must pass with no Spotify Client ID, client secret, access token, refresh token, OAuth callback, or Spotify SDK configured.

Never add a required “Connect Spotify” step; `/me` endpoints; user token storage/refresh; user sharding across Client IDs; bring-your-own Spotify credentials; Exportify automation; or scraping of Spotify pages, the Web Player, or Embed iframes. Never call a playlist link an imported playlist.

Spotify supports playlist Embeds, and its oEmbed endpoint currently returns a public playlist preview, but oEmbed is presentation—not a track-list API. Treat all preview metadata as refreshable and optional. Validate allowed Spotify hosts and responses, prevent SSRF, never inject arbitrary returned HTML, and retain an “Open in Spotify” fallback.

## Claude Code working style

- Inspect before editing. Do not infer the shape of files that can be read.
- Prefer existing project conventions when they do not conflict with `AGENTS.md`.
- Use repository scripts and package-manager lockfiles consistently.
- Keep domain logic independent of React components and HTTP handlers.
- Keep third-party provider code behind adapters.
- Use migrations for every database change.
- Avoid untyped dictionaries and `any`; validate unknown external data.
- Use parameterized queries. Never build SQL from interpolated user input.
- Do not accept an acting `userId` from the client. Derive it from the verified server session.
- Do not log secrets, tokens, magic links, authorization codes, note bodies, imported files, or sensitive provider payloads.
- Default visibility to private.
- Prefer a duplicate recording over a false merge.
- **Honor the catalog policy in `AGENTS.md` §3a.** The catalog is not the product; the notes are. Entry is lax, but user-authored recordings (`origin = user`) stay creator-scoped and out of global resolution. Never create an artist or album row from a name string — only from a provider ID. Never auto-promote one user's free text into a shared entity.
- Do not block note creation on MusicBrainz or Last.fm.
- Do not block note creation on Spotify metadata or Embed availability.
- Do not persist complete provider payloads or raw Embed HTML; store only an allowlisted, size-limited subset with provenance.
- Use synthetic or properly anonymized provider fixtures. Never expose private notes, imported files, tokens, or stored provider data to a coding model.
- Keep commits and review units narrow when the user authorizes commits.
- Do not push, deploy, delete production data, rotate credentials, or mutate external services without explicit permission for that action.

## Required implementation sequence

Follow the detailed phase plan and exit criteria in `AGENTS.md` §12 (~15 working days, not ten).

### Phase A - safety

- Document v1 behavior and risks.
- **Leave v1 running and writable; do not rebuild it** (EOL Node 18 may not build). Its unauthenticated note endpoints are a known, accepted, time-boxed exposure closed at cutover.
- Two backup artifacts, never conflated: the user-run **DR dump** containing live Spotify tokens, which an agent never opens; and a **sanitized export** (`notes` plus `users` projected to `{user, lastModified}`) which an agent may process but whose note bodies must never be printed into a transcript or prompt.
- Record source counts and an export checksum — expect 34 users, 33 notes. Legacy-note import is post-core unless the user explicitly changes scope.
- Do not carry Spotify tokens forward. **Rotate the client secret only at retirement**, never before: v1 still reads it.
- Reconcile and commit `AGENTS.md` and `CLAUDE.md` before writing any application code.

### Phase B - foundation

- Scaffold Next.js/TypeScript.
- Configure PostgreSQL, Prisma, Clerk, Zod, tests, and CI.
- Implement users, artists, `artist_external_ids`, albums, `album_external_ids`, recordings (with `artist_display`, `origin`, `normalized_key`), `recording_artists`, recording external IDs, notes, collections, items, imports, and tags.
- Prove migrations work from an empty database.
- Seed the awkward cases: multi-artist track, a repeated recording in one collection, two users with private notes on one recording, an `origin = user` entry, a note with playlist context, two snapshots of one collection.
- **Stop at Checkpoint 1a** so the user can browse the seeded model in Prisma Studio before any droplet change.
- Then make the **first gated deployment** to `v2.playlistnotes.io` — `noindex`, invite-gated, synthetic data only, URLs generated from `APP_BASE_URL` so nothing bakes in the temporary hostname. The database is a droplet-local role and database, never MKDb's.

### Phase C - secure note vertical slice

- Parse a Spotify or Apple Music track URL without user OAuth.
- Resolve or create a recording with a TrackJot UUID.
- **Consult the database before any provider call.** This is the rate-limit guarantee, and it is asserted by counting calls in `no-network-on-known-track.test.ts` rather than assumed.
- Prefer the provider API (Spotify Client Credentials, Apple's public iTunes lookup) so artists, album and ISRC are linked from identifiers; fall back to oEmbed, then to user-supplied title/artist. A single pasted track must produce the same row as importing the album containing it — both go through `lib/music/persist-track.ts`.
- Create/edit/delete a private note.
- Support an optional TrackJot collection-item context so notes about the same recording in different playlists do not lose their meaning.
- Enforce ownership in server queries.
- Add cross-user denial tests.

### Phase D - CSV collection import

- Parse Exportify-compatible CSV variants.
- Treat Exportify as format compatibility only; never call or scrape it. Support a documented neutral CSV when practical.
- Attach a playlist link as provenance to a collection the user is creating; it creates nothing on its own.
- Preserve order and duplicate tracks. **Every import creates a new immutable snapshot** — never reorder or retarget items beneath an existing note.
- Resolve exact Spotify IDs first. Link artists and albums from the `Artist URI(s)` / `Album URI` columns, never from name columns; capture `ISRC`; retain the raw URI lists in `source_metadata`.
- Report matched/created/skipped/failed rows.
- Make repeated imports safe and deliberate.

### Phase E - sharing and launch

- Add private/unlisted/public visibility.
- Create stable TrackJot-owned public URLs.
- Ensure publishing a collection never implicitly publishes private notes.
- Add user-scoped note search.
- Verify responsive and accessible workflows.
- Deploy only when authorized.
- Add privacy-safe product events and invite approximately ten testers.

### Phase F - first post-core experiment

- Feature-flag Last.fm recent scrobbles.
- Map scrobbles into the same recording-resolution system.
- Do not use Last.fm as the canonical ID or artwork source.
- Do not make a paid feature depend on Last.fm before appropriate commercial permission.

## Mandatory checks for every resource

For every private note, collection, import, or account-owned object:

1. Obtain the verified auth subject server-side.
2. Resolve the local user via `ON CONFLICT (auth_subject)`, so concurrent first requests create exactly one row.
3. Scope the database operation by both resource identity and owner identity.
4. Return a non-disclosing error for cross-user access.
5. Add a negative test that supplies a **valid** UUID belonging to another user.
6. Never let user-entered metadata mutate a shared canonical recording — it becomes a per-note display override.

For every external music item:

1. Validate and normalize the input.
2. Preserve provider provenance.
3. Resolve exact provider ID first.
4. Store an internal UUID independently of the provider.
5. Avoid speculative merges.
6. Degrade gracefully if enrichment is unavailable.

## Validation commands

Use the actual scripts declared by the implemented repository. Establish scripts equivalent to:

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npx prisma migrate status
npm run db:reset:local     # guarded; proves migration from empty
npm run smoke <url>        # real requests to a running server
E2E_BASE_URL=<url> npm run test:e2e
```

**A green build proves less than it appears to.** On 2026-08-10 the whole suite
passed, `next build` succeeded, pm2 reported `online`, and every rendering route
hung for 30 seconds before a 500. Nothing that runs before a server boots can
see that class of failure, so `npm run smoke` — which makes real requests to the
built artifact — runs in CI against the package it is about to upload, and again
after every deploy. Never report a deployment as working without it.

**Never run a bare `npx prisma migrate reset`.** It inherits whatever `DATABASE_URL` is configured. `db:reset:local` must fail closed unless the parsed URL's host is local or CI, the database name matches `*_dev` or `*_test`, and `NODE_ENV` is not `production`. Production only ever runs `prisma migrate deploy`. Integration and E2E suites run against disposable local or CI databases; a deployed environment gets narrow smoke tests with dedicated accounts only.

Do not invent successful results. If a dependency or credential prevents a check, report exactly what ran, what did not, and how to complete it.

Before considering the production invitation ready, prove:

- migrations apply to an empty database
- User A cannot read or mutate User B's private content, **even when supplying a valid UUID**
- anonymous users cannot access private content
- concurrent auth upsert creates exactly one local user; account linking never relies on raw email equality
- Exportify fixture imports preserve order and duplicates
- no artist or album row is ever created from a name string
- a manual entry is stored `origin = user` and excluded from global resolution candidates
- user-entered metadata cannot mutate another user's saved display or the shared canonical recording
- re-import cannot delete, retarget, or reorder items beneath an existing note
- the core flow succeeds with no Spotify Web API credentials and with oEmbed unavailable
- a playlist URL creates no collection and no items
- the staging hostname is gated and `noindex`
- destructive database reset commands reject non-disposable targets
- Heroku auto-deploy is disabled before `main` receives v2
- repeated link/CSV occurrences of the same Spotify track resolve to one recording
- public/unlisted links expose only intended fields
- a public collection does not leak a private contextual note
- the production build succeeds
- backup and restore instructions exist
- no secret or token appears in committed files or logs

## Progress reporting

Maintain `docs/migration-status.md` as the durable handoff between sessions. It must identify the current phase and exit criteria, completed behavior, exact validation commands/results, schema or product decisions, blockers/risks, and the next vertical slice. Update it after every phase and before ending a substantial session.

Ask for a user checkpoint before production deployment, credential rotation, legacy-token deletion, legacy-data import, or any other external/destructive cutover action.

Lead with working product behavior, not files changed. A useful handoff says:

- what a user can now do
- which sprint exit criterion now passes
- validation performed
- remaining risk or blocked dependency
- the smallest recommended next increment

Do not report “migration complete” because scaffolding exists. The rescue is complete only when every definition-of-done item in `AGENTS.md` passes.

## Hiring-story guardrail

Optimize for truthful engineering evidence, not fashionable dependencies. The intended portfolio story is:

> A Spotify-dependent prototype was re-architected into a secure, provider-independent, multi-tenant product with cross-provider identity resolution, ingestion, public/private sharing, production operations, and measured user retention.

Maintain documentation and privacy-safe metrics that can substantiate that story. Never fabricate user counts, performance improvements, scale, revenue, or retention.
