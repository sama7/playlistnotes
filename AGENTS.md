# Playlistnotes v2 - Implementation Contract

This file is the model-agnostic source of truth for agents implementing Playlistnotes v2. Read it completely before changing code. `CLAUDE.md` is an adapter for Claude Code and must not override this file.

**Contract precedence:** this `AGENTS.md` > `CLAUDE.md` > `docs/v2-plan/playlistnotes-v2-report.html` and any archived planning material. The report is narrative rationale and is **non-normative**; it predates the August 7, 2026 reconciliation and disagrees with this file in several places. Where they differ, this file wins.

## 1. Mission

Rebuild Playlistnotes as a provider-independent music journal in which people can privately annotate recordings, organize them into collections, and deliberately share selected notes or collections.

The v2 product must not require a Spotify login. Spotify, Last.fm, MusicBrainz, Apple Music, YouTube, Bandcamp, and similar services are optional sources or destinations. Playlistnotes owns its user accounts, notes, collections, privacy rules, public URLs, and internal music identifiers.

The initial product hypothesis is:

> People want a fast, durable place to capture the meaning, memories, observations, and context they associate with music.

The initial validation question is:

> After creating one note, do any invited users independently return on a later day to create another?

### Why the direction changed: Spotify access is a hard product constraint

Policy baseline checked August 6, 2026:

- Spotify Development Mode requires the app owner to have an active Spotify Premium subscription and permits at most **five allowlisted authenticated Spotify users per app**. A non-allowlisted user may appear to complete OAuth, but API requests made with that token return `403`.
- Spotify raised the limit to **25 Client IDs per developer account** on July 23, 2026. That is a limit on app identifiers, not users. All Development Mode apps under the developer account share one API quota; do not shard Playlistnotes users across Client IDs or treat multiple IDs as a scaling strategy.
- Spotify's February 2026 migration guide says apps that already had more than five authorized users may retain that existing cohort, but the restriction applies to users added going forward. **Verified on the Playlistnotes dashboard: 20 users were onboarded through User Management and are grandfathered above the current cap.** That cohort is a test asset, not a growth plan — no further users can be added, so v1 cannot onboard testers.
- Extended Quota Mode still permits an unlimited number of authorized Spotify users, but new applications currently require an established organization, a launched service, at least 250,000 monthly active users, key-market availability, commercial viability, and policy compliance. It is a possible future partnership path, not an MVP dependency.
- Spotify describes Development Mode as a sandbox for personal, non-commercial experimentation and says it should not be the foundation of a scalable business.

The five-user rule constrains users who authenticate with Playlistnotes' Spotify application. It does **not** constrain Playlistnotes-owned accounts or visitors who open public Spotify links and Embeds. V2 therefore separates product identity from provider identity.

Official references: [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [February 2026 access update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security), [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), and [July 2026 quota update](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates).

**Core independence invariant:** account creation, track-note creation, collection import, search, sharing, and return use must work when no Spotify Client ID, client secret, access token, refresh token, OAuth callback, or Spotify SDK is configured.

## 2. Authority and safety

- Do not deploy, change DNS, rotate or delete credentials, remove production data, publish a package, push a branch, or open a pull request without explicit user authorization for that action.
- Read the current repository and production documentation before implementation.
- The reference v1 repository is `https://github.com/sama7/playlistnotes`.
- The reference operations project is `https://github.com/sama7/mkdb`.
- **Repository location is decided: v2 lives on the long-lived `v2` branch of `sama7/playlistnotes`.** `main` is frozen — it has **confirmed automatic Heroku deploys** for the app `playlistnotes`, and v1 pins Node `18.12.1`, so a push to `main` would trigger a build that likely fails. Never push or merge to `main` without explicit cutover approval. The only git remote is named `github`; there is no `origin`.
- Preserve a read-only export of the legacy MongoDB data before any production cleanup.
- Never migrate legacy Spotify access or refresh tokens into v2.
- Never log credentials, authentication tokens, session identifiers, magic links, authorization codes, or complete third-party payloads that may contain personal data.
- Recheck live third-party documentation and terms before implementing or launching an integration. Policy facts in this plan are dated context, not a promise that provider behavior will remain unchanged.
- When requirements are uncertain, choose the smallest reversible implementation that preserves the product mission.

## 3. Current-state findings that v2 must correct

The current v1 implementation is a small JavaScript/Express/Create React App application backed by MongoDB and coupled to Spotify OAuth.

Known issues:

- Spotify identity is treated as Playlistnotes identity.
- Note routes trust `user`, `playlist`, and `track` values supplied by the browser.
- Note reads, updates, and deletes do not enforce an authenticated owner on the server.
- Spotify access and refresh tokens are stored and logged.
- One mutable Spotify API client is shared across requests, which is unsafe under concurrent users.
- Notes are keyed to Spotify playlist and track identifiers, preventing provider independence.
- The app cannot serve new users at scale under Spotify Development Mode.
- The frontend uses `react-scripts`; Create React App is deprecated.
- The repository has no meaningful automated test suite.

Do not patch these defects into the old identity model. Replace the model.

### Legacy data disposition

The production dataset is tiny — **34 user documents and 33 notes, with nothing written since 2024** — so legacy import is not launch-critical. The default rescue plan is to start v2 clean after creating an immutable MongoDB export with a checksum and source counts. Do not spend the sprint building a general migration unless the user explicitly promotes it into scope.

Because v1 has been inactive since 2024, no write-cutoff ceremony is required: one export plus a count re-check immediately before import is sufficient.

**Two distinct artifacts. Never conflate them.**

1. **Disaster-recovery backup.** The full `mongodump`, which includes the `users` collection and therefore **live Spotify access and refresh tokens**. The user runs this themselves; the connection string never enters an agent transcript. Encrypted at rest, restrictive file permissions, stored outside the repository, checksum and per-collection counts recorded, encryption key stored separately. **An agent never opens, reads, or inspects this file.**
2. **Sanitized migration export.** `notes` in full, plus `users` projected to `{user, lastModified}` only — never `accessToken`, `refreshToken`, or `expiresIn`. This is the only legacy dataset an agent may work with, and even then: it contains private note bodies, so an agent may **process it programmatically but must never print note bodies into a transcript, log, or model prompt**. Develop against synthetic fixtures of the same shape.

If legacy notes are imported later:

- Rehearse against a disposable database and reconcile source and target counts.
- Default imported notes to `private`.
- Map legacy Spotify track IDs into `recording_external_ids` and preserve legacy IDs in an idempotent audit mapping.
- Preserve playlist context by creating a clearly labeled **partial legacy collection** containing only the note-associated items, ordered deterministically by legacy `timeCreated`. Never present it as a complete historical Spotify playlist — v2 cannot enumerate a playlist's tracks without OAuth. When the relationship is ambiguous, retain provenance only.
- Map legacy users to v2 accounts from an explicit user-supplied `spotify_user_id → playlistnotes_user_id` map (expected to be 1–5 entries).
- Never associate a legacy user with a new account using only a display name or unverified email.
- Never copy Spotify access tokens, refresh tokens, or client credentials.

## 3a. Catalog policy

The honest risk in v2 is not schema design; it is drifting into catalog maintenance nobody has staffed. **The catalog is not the product. The notes are.** MusicBrainz must be correct about all music; Playlistnotes must guarantee that a note you wrote is findable later. Only the second is a promise to users.

1. **Growth is bounded by user behavior, not by music.** Rows are created only when a user adds a song. No crawling, no catalog sync, no corpus to keep fresh. 1,000 users × 500 tracks is 500k rows — unremarkable for PostgreSQL.
2. **A duplicate only costs something when two users must share the row.** Today each user sees only their own notes, so a duplicated recording is invisible and "prefer a duplicate over a false merge" is nearly free. That changes when the catalog becomes shared surface.
3. **Exposing the catalog is a milestone that ships *with* its tooling, not a line never to cross.** Artist pages, track pages, and collaborative collections are wanted (§16 backlog). The rule is sequencing: the release that first shows one recording to many users is the release that carries merge tooling, a `needs_review` admin view, and redirect-preserving `merged_into_id` behavior — budgeted together, never retrofitted. **The dominant cost there is user-generated-content moderation, not entity deduplication:** once notes from many people appear on a shared page, spam, abuse, and reports follow, and that needs policy.
4. **A trusted provider is one where the identifier is issued by an authority, not chosen by an uploader.** This is the rule that decides which sources may establish identity, and it admits no exceptions based on display strings.

   Permitted: `spotify`, `apple_music`, `deezer`, `tidal` (IDs issued by the platform, catalog fed by labels and distributors through a verified pipeline) and `musicbrainz`, `discogs` (IDs issued by curated, moderated, edit-audited databases).

   Excluded, and not to be re-added without a concrete need: **YouTube, SoundCloud, and Bandcamp**, where identifiers attach to *uploads*. The ID is real; what it points at is uploader-controlled. Note specifically that YouTube's "*Artist* - Topic" convention is **not** a safety signal — channel names are neither unique nor protected, so anyone can create a channel called "Drake - Topic" and upload anything to it. Never gate trust on an attacker-controllable display string. Hardening YouTube would require an API key, quota management, and a channel-ID allowlist, to gain nothing the permitted sources already provide. Also excluded: `lastfm` (listening history is never an authority) and `rym` (no public API, and its terms forbid scraping).

   **This restricts promotion, not expression.** Anything unfindable may still be entered by hand; it stays `origin = user`, scoped to its creator, and cannot be promoted into shared truth by an unverifiable source. Spam is free to exist privately.

5. **Identifiers do the work; humans do not.** Exact `(provider, provider_id)` handles the overwhelming majority, since every user's Spotify URI for a track is identical. ISRC and MusicBrainz MBIDs later close most cross-provider overlap asynchronously. The residue goes to a `needs_review` queue that can be ignored indefinitely without breaking the product. LLM-assisted resolution is a later option for that residue only — a wrong automatic merge is worse than a duplicate and harder to undo.
6. **Entry is lax; the shared catalog is not — but the wall is a default, not permanent.** A music journal must hold the mp3 a friend sent, the vinyl-only B-side, the unreleased demo, a local band, so free-form entry is allowed. Safety comes from tiering rather than gatekeeping: a recording is **provider-anchored** (≥1 `recording_external_ids` row) or **user-authored** (none, `origin = user`). User-authored recordings are creator-scoped by default and stay out of global resolution candidates and any future public page.

   Three promotion paths keep the Last.fm-style outcome available later: **(a) identifier acquisition** — the recording later matches a provider ID and becomes provider-anchored automatically, with the canonical name coming from the provider rather than user text; **(b) convergence** — several users independently create recordings sharing a `normalized_key`; **(c) manual promotion** from the review queue.

   **Safety rule: never auto-promote a single user's free text into a shared public entity.** User-supplied titles are arbitrary strings that may contain garbage, personal information, or abuse. Promotion happens via (a), or via (b) above a threshold — never from one person's typing.

Enrichment across MusicBrainz, Last.fm, Apple Music, Tidal, and Wikipedia is explicitly **post-retention-signal**. Entity tables now because they are cheap and correct; enrichment only after someone returns to write a second note.

## 4. Locked product decisions

Unless the user explicitly changes a decision, implement the following:

1. Playlistnotes has first-party accounts managed through an established authentication provider or library.
2. Initial sign-in methods are email one-time code and Google. Apple is deferred until a native application or demonstrated demand.
3. A user can paste a Spotify track link and create a note without authorizing Spotify.
4. **A playlist link is provenance on a collection, not a feature that creates one.** Because `notes.recording_id` is NOT NULL, a note about a playlist is impossible by construction, so a link-created "collection reference" would be a bookmark with zero songs, outside the core loop, that reliably provokes "why are there no tracks?". Therefore: pasting a public Spotify playlist URL **while creating a collection** attaches provenance — `source_url`, a name prefilled from oEmbed, an "Open in Spotify" link, and a compliant Embed rendered on the collection page including public shares. Pasting one into the main "add music" box **creates nothing**; it explains that Playlistnotes cannot read a playlist's tracks from Spotify and offers the two real paths: import a CSV, or start a collection and add tracks by link. The invariant is therefore stronger than "zero inferred items": **a playlist link never creates a collection or a collection item.** If playlist-level journaling is wanted later, the honest form is a collection-level note (`recording_id` nullable, XOR `collection_id`) — a deliberate decision, not an empty bookmark.
5. A user can populate a Playlistnotes collection snapshot from an Exportify-compatible or documented neutral CSV. The uploaded file—not a playlist iframe—is authoritative for its item list.
6. Every note references a recording. A note may also reference a Playlistnotes `collection_item` to preserve playlist-specific context; multiple journal entries per recording are allowed.
7. Importing or publishing a collection never publishes note bodies implicitly. Each note retains its own visibility and must be deliberately exposed.
8. A user can create, edit, delete, search, and tag their own notes.
9. Notes and collections support `private`, `unlisted`, and `public` visibility.
10. A public URL is owned by Playlistnotes and remains stable if an external provider ID changes.
11. Last.fm recent-listen import is the first post-core integration, not the canonical music database.
12. MusicBrainz is an optional resolution/enrichment layer, not the Playlistnotes primary key.
13. Exportify is a CSV compatibility target, not a runtime dependency, API integration, endorsement, or guaranteed long-term source. Never scrape or automate Exportify.
14. Existing Spotify OAuth may be preserved only as an isolated, feature-flagged legacy experiment for an already authorized cohort. It is not part of v2 onboarding or any core workflow.
15. No billing, end-to-end encryption, React Native, collaboration, or automatic Spotify synchronization in the rescue sprint.
16. Clerk **webhooks are out of scope**. Resolve the local user by lazy upsert on the first authenticated request, using `INSERT … ON CONFLICT (auth_subject)` so concurrent first requests create exactly one row.

### Why Clerk — examined August 9, 2026, not inherited

Clerk arrived in this contract as an unexamined default. It was compared against SuperTokens and survived, for these reasons. Recorded so the question is not relitigated from stale information.

**Cost, at this project's realistic scale.** Clerk's free tier is 50,000 monthly *retained* users (someone counts only if they return 24h after signing up), then $25/mo. SuperTokens' managed service is free to 5,000 MAU and then carries a **$100/month minimum** — a cliff, not a ramp. Clerk is therefore cheaper across the entire plausible range, not more expensive. Widely-circulated complaints about Clerk pricing date from its September 2023 change and describe a tier that no longer exists.

**Self-hosting is free in fees, not in resources.** The SuperTokens core is a JVM service whose own guidance is a ~1 GB baseline. The droplet is 2 GB and already runs MKDb, mankbot, and MKDb's PostgreSQL; adding a JVM would consume the headroom that keeps the OOM killer away from MKDb's database, and would in practice require a 4 GB droplet — spending ~$12/mo more to replace something currently costing nothing, plus a service to patch on a 2–3 h/day budget.

**What SuperTokens genuinely wins, and is worth revisiting for:** it is Apache 2.0 and self-hostable (no vendor pricing risk), user data stays in your own PostgreSQL, and **passkeys are included free** whereas Clerk gates them behind Pro at $25/mo.

**Why the lock-in risk is acceptable:** `users.auth_subject` is a mapping, never a primary key. Every note, collection, and import is scoped by a Playlistnotes UUID, so changing provider means exporting users, creating them elsewhere, and updating one column. That is deliberate insurance, and it is what makes this decision reversible.

**Revisit when** any of these becomes true: approaching 50,000 MRU; Clerk changes pricing again; data sovereignty becomes a requirement; or passkeys become urgent enough that Pro's cost bites.

**Sessions — a scheduled decision, not a settled one.** Clerk's default maximum lifetime is 7 days, is **fixed from sign-in rather than sliding with activity**, and cannot be changed on the free tier in production. A user who opens Playlistnotes daily is still signed out every seventh day. SuperTokens, by contrast, defaults its refresh token to **100 days and does slide** — any activity extends it — and it is a plain config value with no paywall.

This matters more than a normal UX papercut for two reasons: a journal is used at roughly weekly cadence, which is almost exactly where a 7-day hard expiry lands; and §13's validation metric is later-day return, so the friction sits directly on the measurement. Retention measured through a login wall cannot distinguish "did not care" from "could not be bothered to re-authenticate."

**Decision, August 9 2026: do not switch during Phase 2; re-evaluate at the invite gate.** With one user, session length is irrelevant; with ten testers it is not. Building the note vertical slice matters more than re-plumbing working auth, and migration stays cheap because there are no passwords — users re-verify by email and only `auth_subject` changes.

**The likely outcome is SuperTokens' managed tier**, which is free below 5,000 MAU, gives 100-day sliding sessions, includes passkeys, and needs no JVM beside MKDb's PostgreSQL. Its $100/month floor above 5,000 MAU is a far-away problem; Clerk's session friction is a next-week problem.

**Do not decide this from intuition.** `auth_lapses` records, pseudonymously, when a returning visitor meets a sign-in prompt and how long it had been. Read it before the invite goes out.

**No passwords.** §4.2 stands and was re-confirmed. Passwords are the dominant account-compromise vector via reuse and credential stuffing, they drag in a reset flow and its attack surface, and every added method multiplies account-linking edge cases. They also solve nothing users want here: the complaint that motivates them is "don't make me type a code," and a password is more typing plus memory. Passkeys answer that properly. Clerk enables password sign-up by default — keep it off.

## 5. Target architecture

Build a modular monolith. Do not create microservices for the initial release.

Recommended stack:

- Next.js App Router with React and strict TypeScript
- Active Node.js LTS pinned in the repository
- PostgreSQL 16 or newer
- Prisma for schema migrations and ordinary application queries
- Raw parameterized SQL only where PostgreSQL-specific features are materially clearer or faster
- Clerk for managed authentication, using email one-time codes and Google
- Zod for server-boundary validation
- Vitest and React Testing Library for unit/component tests
- Playwright for browser-level acceptance tests
- Sentry for application errors when credentials are supplied
- PostHog for a minimal product-event taxonomy when credentials are supplied
- GitHub Actions for typecheck, lint, test, migration validation, and production build
- A long-running Node process behind nginx on DigitalOcean, managed consistently with the user's existing operational approach
- DigitalOcean Managed PostgreSQL when the user accepts the additional cost; otherwise a separate local PostgreSQL database and role with verified off-host backups

Keep a stable, documented REST surface under `/api/v1` for future React Native clients. Server actions may be used for tightly coupled web mutations, but every material capability needed by a future native client must have a clear service-layer boundary.

## 6. Domain model

Use UUID primary keys generated by Playlistnotes. External identifiers are mappings, never primary keys.

### Required entities

#### `users`

- `id uuid primary key`
- `auth_subject text unique not null`
- `username text unique`
- `display_name text`
- `avatar_url text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

The authenticated server session supplies `auth_subject`. Never accept the acting user ID from a request body or query string.

#### `artists`

- `id uuid primary key`
- `name text not null`
- `sort_name text`
- timestamps

#### `recordings`

- `id uuid primary key`
- `title text not null`
- `artist_display text not null` — the raw artist string exactly as the source gave it; **always populated**, never parsed into entities
- `origin` enum: `provider`, `user` — the §3a.5 tiering
- `normalized_key text not null` — lowercased, punctuation- and "feat."-stripped artist+title plus a duration bucket, computed on every write
- `duration_ms integer`
- `release_title text`
- `release_date date`
- `artwork_url text`
- `merged_into_id uuid null references recordings(id)`
- `canonical_metadata jsonb not null default '{}'`
- timestamps

`merged_into_id` permits conservative deduplication later while retaining redirects from old public IDs. **Resolution must never return a recording whose `merged_into_id` is set** — follow the redirect. The merge *administration* surface is post-core; the column and the guard ship now.

`artist_display` and `release_title` are denormalized display strings that are always present, so every capture path renders correctly even when structured linkage is impossible. The **track-link path supplies no artist or album IDs and no ISRC**, so link-captured recordings have display strings and no entity linkage; manual entries are `origin = user`. Uneven population across paths is expected and correct.

`normalized_key` is written from day one so that future convergence-based promotion (§3a.5b) is a query rather than a bulk re-normalization of the whole table. Nothing in the rescue sprint reads it.

**Canonical metadata is write-once at creation.** A user's typed title/artist may initialize a recording when it is first created; thereafter another user's typed input never mutates the shared row — it becomes a per-note display override (see `notes`).

A recording represents a specific recorded performance/version, not an abstract composition. Playlistnotes creates recordings lazily as users add music; it does not need or ingest a complete global song catalog. A manually entered recording may exist without any external identifier.

#### `artist_external_ids`

Mirrors `recording_external_ids` exactly: `id`, `artist_id`, `provider`, `provider_id`, `provider_url`, `source_metadata jsonb`, `first_seen_at`, `last_verified_at`, `unique(provider, provider_id)`.

**Identity comes only from provider IDs; names are display data.** An `artists` row is never created from a name string. A wrong name is a cosmetic bug that can be corrected; a name-derived entity is a false merge that cannot be safely undone. Exportify's `Artist URI(s)` column splits on commas unambiguously (URIs contain no commas), which is what makes entity linkage at ingest safe. When a row carries exactly one artist URI, the whole `Artist Name(s)` value is that artist's name unambiguously; with several URIs, create the artist rows by ID and leave individual names unset until an enrichment source fills them, while `recordings.artist_display` carries the UI.

#### `recording_artists`

- `recording_id uuid references recordings(id)`
- `artist_id uuid references artists(id)`
- `position integer not null`
- `credit_name text`
- primary key or unique constraint preserving artist order per recording

**Why this is a table and not a `uuid[]` column on `recordings`.** In a product without artist pages this is a close call, and a GIN-indexed array is a legitimate pattern. Three things decide it: (1) **PostgreSQL cannot enforce a foreign key on array elements**, so `artist_ids uuid[]` can silently retain UUIDs for deleted artists; (2) artist pages are a **paginated reverse lookup** ("recordings by artist X", ordered, paged), which a btree on `recording_artists(artist_id)` serves natively and array containment serves poorly; (3) **per-credit attributes have nowhere to live in an array** — `credit_name`, "feat." versus "&", and producer/remixer roles later.

**`position` is the source's ordering as captured — never a canonical claim about billing.** Sources disagree about credit order, and that disagreement is precisely why a per-pair row exists: it can record "this source credited this artist at this position under this name." Do not treat position as truth about who deserves top billing.

#### `albums`

- `id uuid primary key`
- `title text not null`
- `primary_artist_id uuid null references artists(id)`
- `artist_display text` — raw album-artist string as given
- `release_date date`
- `artwork_url text`
- timestamps

Plus `album_external_ids`, mirroring `artist_external_ids`.

**There is deliberately no `album_artists` join table.** Album-level multi-artist credits are far rarer than track-level features and nothing in the product surfaces them yet, so `primary_artist_id` plus `artist_display` suffices. This deferral is safe for one specific reason — **retain the identifiers, defer only the structure**: the full `Album Artist URI(s)` list is persisted in the album's `source_metadata`, and the full `Artist URI(s)` list in the recording's, so a future `album_artists` table is a pure backfill from data already held, with no reconstruction from strings. Deferring artist linkage *entirely* would not have had this property, which is why entity tables ship now and the album join table does not.

#### `recording_external_ids`

- `id uuid primary key`
- `recording_id uuid references recordings(id)`
- `provider text not null`
- `provider_id text not null`
- `provider_url text`
- `isrc text`
- `musicbrainz_recording_id uuid`
- `source_metadata jsonb not null default '{}'`
- `first_seen_at timestamptz not null`
- `last_verified_at timestamptz`
- `unique(provider, provider_id)`

Normalize provider names to a controlled enum or checked text values such as `spotify`, `lastfm`, `musicbrainz`, `apple_music`, `youtube`, and `bandcamp`.

Do not invent a provider ID merely to fill this table. `source_metadata` contains only an allowlisted, size-limited subset needed by the product plus provenance and retrieval time—not a complete provider response or raw Embed HTML.

#### `notes`

- `id uuid primary key`
- `owner_id uuid references users(id)`
- `recording_id uuid references recordings(id)`
- `collection_item_id uuid null references collection_items(id) **on delete set null**`
- `body text not null`
- `display_title text` / `display_artist text` — per-note overrides, rendered as `override ?? canonical`
- `share_token text unique` — random, rotatable; used for `unlisted` URLs
- `visibility` enum: `private`, `unlisted`, `public`
- `published_at timestamptz`
- timestamps

`ON DELETE SET NULL` is a backstop, not a mechanism: **a user's note must never be deleted or silently retargeted by an import.** See `collection_items` for the snapshot rule that makes this true by construction.

`display_title` / `display_artist` exist because `recordings` are shared across users. User-typed metadata initializes a recording at creation; afterwards it is stored here, so **one user's correction can never change what another user saved**.

`share_token` exists so an unlisted link can be **revoked by rotation** without destroying the note. Do not expose the internal note UUID as the share URL. Unlisted pages must send `X-Robots-Tag: noindex`.

Store note content as text or a deliberately chosen structured editor format. Do not store HTML produced from untrusted input. Escape on output according to the renderer.

When `collection_item_id` is present, the service must verify that the item belongs to the note owner and points to the same `recording_id`. This optional context preserves v1's “this track in this playlist” meaning without using a Spotify playlist ID as an ownership boundary.

#### `collections`

- `id uuid primary key`
- `owner_id uuid references users(id)`
- `name text not null`
- `description text`
- `visibility` enum
- `source_provider text`
- `source_id text`
- `source_url text`
- `source_snapshot_at timestamptz`
- `import_id uuid null references imports(id)` — which import produced this snapshot
- timestamps

#### `collection_items`

- `id uuid primary key`
- `collection_id uuid references collections(id)`
- `recording_id uuid references recordings(id)`
- `position integer not null`
- `source_metadata jsonb not null default '{}'`
- `unique(collection_id, position)`

Do not enforce uniqueness on `(collection_id, recording_id)`: a playlist can intentionally contain the same recording more than once.

**Snapshots are immutable.** Every successful CSV import creates a **new** collection snapshot with new items; re-import never replaces, reorders, or retargets items beneath an existing note. Old snapshots remain reachable while notes reference their items, and the UI distinguishes import date and source so the user chooses which to publish or archive. Because items are inserted once per transaction and never reordered in place, an **ordinary** unique constraint on `(collection_id, position)` is sufficient — do not add a `DEFERRABLE` constraint until a real reorder workflow exists, which is post-core.

#### `imports`

- `id uuid primary key`
- `owner_id uuid references users(id)`
- `provider text not null`
- `filename text`
- `content_hash text`
- `status` enum: `pending`, `processing`, `completed`, `failed`
- `row_count integer`
- `error_summary text`
- timestamps

An import must be idempotent or explicitly warn before duplicating a prior import with the same hash.

#### Tags

Use normalized `tags` and `note_tags` tables. Tag names are unique per owner unless product requirements later make tags global.

### Required indexes

- `recording_external_ids(provider, provider_id)` unique
- `artist_external_ids(provider, provider_id)` unique
- `album_external_ids(provider, provider_id)` unique
- `recording_artists(artist_id)` — the reverse lookup behind future artist pages
- `recordings(normalized_key)` — future convergence detection
- `collections(import_id)`
- `notes(owner_id, updated_at desc)`
- `notes(recording_id)`
- `notes(collection_item_id)`
- `notes(visibility, published_at desc)` where visibility is not private
- `collections(owner_id, updated_at desc)`
- `collection_items(collection_id, position)`
- `imports(owner_id, created_at desc)`
- Appropriate unique case-insensitive username and tag indexes

Add PostgreSQL full-text or trigram indexes only after the corresponding query exists and is tested. Do not add Elasticsearch or OpenSearch during the rescue sprint.

## 7. Recording resolution rules

Resolution must be conservative. A false merge is worse than a temporary duplicate.

Internal UUIDs are server-generated and are never derived from a Spotify ID, ISRC, MusicBrainz ID, or normalized metadata. Similar names are evidence, not identity. A removed provider mapping must not break a Playlistnotes public URL.

Match in this order:

1. Exact `(provider, provider_id)`.
2. Exact MusicBrainz recording MBID when present and trusted.
3. Exact ISRC with corroborating artist/title metadata.
4. High-confidence comparison of normalized artist, title, version markers, duration, and release.
5. If confidence is insufficient, create a separate recording.

**Candidate scoping.** Resolution candidates exclude recordings whose `merged_into_id` is set (follow the redirect instead) and recordings with `origin = user` belonging to another user (§3a.5). Exportify CSVs carry an `ISRC` column, so step 3 is available for free on the bulk import path; the track-link path has neither ISRC nor provider artist IDs and therefore relies on step 1 alone.

Never merge solely because normalized title and artist strings are equal. Preserve distinctions such as live performance, remix, cover, radio edit, acoustic version, and materially different recording.

Resolution code must return both a result and provenance:

- resolution strategy
- confidence
- candidate identifiers
- decision (`matched`, `created`, or `needs_review`)

Implement an internal merge operation later that points losing records to `merged_into_id`, moves external mappings safely, and preserves public redirects.

## 8. Source adapters

Each music source must implement a small provider interface rather than leaking provider-specific data through the application.

Suggested responsibilities:

- Parse and validate a source URL or imported record.
- Return normalized metadata plus only the allowlisted provider fields and provenance the product actually needs.
- Return stable provider identifiers when available.
- Return an open/play URL and optional embed representation.
- Declare attribution and caching requirements.

### Rescue-sprint source capability matrix

| Input | Supported behavior | Explicit boundary |
| --- | --- | --- |
| Spotify track URL or URI | Parse the track ID, resolve/create a Playlistnotes recording, fetch approved display metadata when available, and create a note | No Spotify login, library access, or permanent dependence on metadata availability |
| Public Spotify playlist URL | **Attach provenance to a collection the user is creating** — source URL, oEmbed-prefilled name, "Open in Spotify", optional compliant Embed | **Creates no collection and no items on its own.** Do not infer, enumerate, or claim to import its track items |
| Exportify-compatible or neutral CSV | Create an ordered Playlistnotes collection snapshot and preserve duplicates | No live synchronization; Exportify is not called by Playlistnotes |
| Spotify album or artist URL | Optional source card/Embed after the core track workflow | Do not create child recordings from the link during the rescue sprint |
| Spotify library or private playlists | Unsupported in the rescue sprint | No `/me`, library, playlist OAuth scopes, or user token storage |

Never implement user sharding across Client IDs, “bring your own Spotify credentials,” Web Player/Embed scraping, or browser automation as a way around Development Mode.

### Spotify link adapter

- Accept official HTTPS Spotify track URLs and URIs. Support Spotify short links only through a bounded, allowlisted redirect-resolution path.
- Strip irrelevant query parameters.
- Store the Spotify track ID as an external mapping.
- Use Spotify's public oEmbed/Embed mechanism only as best-effort presentation metadata when available; it does not require Spotify OAuth.
- Permit note creation when metadata lookup times out, returns `404`, or is unavailable. Require minimal user-supplied title/artist metadata rather than blocking the note.
- Allowlist schemes, hosts, paths, response sizes, timeouts, and redirects to prevent SSRF. Never generic-fetch an arbitrary user URL.
- Do not inject returned Embed HTML directly. Construct or strictly validate the iframe URL and attributes from an approved Spotify response.
- Official documentation supports playlist Embeds, and the live oEmbed endpoint currently returns playlist previews, but the oEmbed reference does not list playlists in its request entity types. Treat playlist preview metadata as best-effort and always retain an “Open in Spotify” fallback.
- Do not require Spotify OAuth.
- Do not inspect, scrape, or treat a playlist iframe as a machine-readable track listing.
- Attribute Spotify metadata correctly, link back to the applicable Spotify item, and do not download or rehost audio or artwork.

### Exportify CSV adapter

- Treat Exportify as file-format compatibility only. Do not call, authenticate to, scrape, or depend on the Exportify service.
- Support a documented neutral CSV shape in addition to recognizable Exportify headers when practical.
- Support common Exportify column names and tolerate harmless column-order differences. The documented Exportify column set is: `Track URI`, `Track Name`, `Artist URI(s)`, `Artist Name(s)`, `Album URI`, `Album Name`, `Album Artist URI(s)`, `Album Artist Name(s)`, `Album Release Date`, `Album Image URL`, `Disc Number`, `Track Number`, `Track Duration (ms)`, `Track Preview URL`, `Explicit?`, `Popularity`, `ISRC`, `Added By`, `Added At`.
- **Link entities at ingest from the URI columns, never from the name columns** (§6). Capture `ISRC` into `recording_external_ids.isrc`. Persist the raw `Artist URI(s)` and `Album Artist URI(s)` lists in `source_metadata` so later structural backfills need no string parsing. Store `Album Image URL` as a link only — never rehost artwork.
- Commit anonymized fixtures and centrally define accepted header aliases. Cover UTF-8 BOMs, quoted commas/newlines, Unicode, duplicates, malformed rows, and explicit file-size/row-count limits.
- Parse and preview before writing. Validate required fields and report row-level errors without losing all valid rows.
- Preserve source order and duplicates.
- Use one database transaction for the collection plus its successfully parsed items, or a staged import with an explicit finalization transaction.
- Display an import summary: created, matched, skipped, and failed rows.
- Use SHA-256 of the original bytes as the content hash. A repeated hash must warn and require an explicit choice; never silently duplicate or silently reject it.
- A completely invalid file creates no collection.
- Keep the original file only if the retention and privacy policy explicitly permits it; otherwise retain the hash and normalized results.

### Last.fm adapter - post-core

- Start with recent scrobbles and optionally loved/top tracks.
- Treat a Last.fm username as a source setting, not Playlistnotes authentication.
- Verify profile ownership only if the product claims the profile is verified.
- Do not use Last.fm as the canonical recording identity.
- Do not use Last.fm-provided artwork under the ordinary API terms.
- Keep the integration feature-flagged.
- Obtain an appropriate Last.fm commercial agreement before relying on Last.fm data in a paid product.

### MusicBrainz resolver - post-core

- Resolve asynchronously and cache responsibly.
- Set a meaningful User-Agent and comply with rate limits.
- Store MBIDs as external mappings.
- Do not block note creation when MusicBrainz is unavailable or ambiguous.

## 9. Authentication and authorization

Authentication answers who the user is. Authorization decides whether that user can perform the requested action. Every mutation and private read requires both.

Rules:

- Derive the acting identity only from the verified server session.
- Map the external auth subject to one local `users` row via `INSERT … ON CONFLICT (auth_subject)`, so that **concurrent first requests for one verified subject create exactly one row**. Prisma's `upsert` races here; use the conflict clause or catch the unique violation and re-read. Add an explicit concurrency test.
- Scope every owner query by the authenticated local user ID.
- For updates/deletes, query by both resource ID and owner ID in one operation where practical.
- Return `404` rather than disclosing that another user's private resource exists.
- Public resources are readable without authentication only when visibility permits it.
- Unlisted resources are addressable by an unguessable ID but absent from listings and search.
- Private resources never appear in metadata, feeds, counts, search results, logs, or public caching layers.
- Enforce authorization in service/server code even if UI controls hide actions.
- Add negative integration tests for cross-user access.
- Configure secure, HTTP-only, SameSite cookies as supported by the auth provider.
- Protect cookie-authenticated mutations against CSRF/origin abuse using the framework and auth provider's recommended controls.
- Keep development and production auth instances, keys, and redirect URLs separate.
- Do not merge accounts merely because two unverified email strings match. Delegate supported account linking to the auth provider and document the behavior.
- Define case-insensitive username uniqueness and reserve application-route names before public profiles launch.
- Validate webhook signatures if webhooks are used.
- Make webhook processing idempotent.
- Implement rate limits and request size limits at sensitive endpoints.

Do not implement passwords, password reset, OAuth token handling, or session cryptography from scratch.

## 10. API and service conventions

- Use a modular monolith organized by domain: auth/users, recordings, notes, collections, imports, and providers.
- Keep HTTP parsing and response formatting out of domain services.
- Validate all external input at the boundary with Zod.
- Use structured error types and safe client messages.
- Use cursor pagination for unbounded lists.
- Use transactions for imports, visibility changes with related side effects, and merge operations.
- Make import endpoints idempotent.
- Do not expose raw database rows or provider payloads directly to clients.
- Keep `/api/v1` bounded during the sprint to the core native-relevant endpoints (note CRUD, recording resolution, collection reads) as thin HTTP adapters over the same domain services the web Server Actions call. Broad OpenAPI coverage is post-core; do not build two full parallel surfaces.
- Use UTC in storage and explicit user locale/timezone in presentation.

## 11. Privacy, security, and content

- Default all new notes and collections to `private`.
- Require an explicit action to publish.
- Provide a clear preview of what public viewers will see.
- Avoid storing third-party artwork unless the applicable license/terms permit it. Prefer compliant embeds or source URLs.
- Prefer click-to-load third-party Embeds and disclose that loading one contacts Spotify and may set third-party cookies.
- Establish content length limits and plain-text rendering before supporting rich text.
- Add account export and deletion to the post-MVP privacy backlog.
- Do not implement end-to-end encryption in this sprint. E2EE complicates server search, public sharing, account recovery, moderation, and multi-device key management; it requires its own threat model.
- Keep secrets only in environment or secret-management facilities. Commit a redacted `.env.example`, never real values.
- **The staging deployment is gated from its first day.** `v2.playlistnotes.io` must ship with `noindex` and non-canonical metadata, a registration/invitation gate, baseline security headers, request and body size limits, rate limiting, separate Clerk development and production instances and keys, correct proxy trust so limits see real client IPs, and synthetic test accounts and data only. **Never bake the temporary `v2.` hostname into stored records** — generate absolute URLs from a runtime `APP_BASE_URL` so early share links survive the cutover to the apex domain.
- Run cross-user and destructive integration/E2E suites against disposable local or CI databases only. Against any deployed environment, run narrow smoke tests with dedicated test accounts; never point reset-heavy suites at the production-candidate database.
- Add dependency scanning and keep dependencies current.
- Use synthetic or properly anonymized fixtures in coding-agent prompts and tests. Never send private notes, imported user files, tokens, or stored provider payloads to an AI model.

## 12. Rescue sprint — approximately 15 working days at 2–3 focused hours per day

The sprint is a timebox, not a promise to include every desirable feature. Prefer a complete, secure vertical slice over breadth.

**Schedule note.** The original ten-day plan under-budgeted the work; a realistic estimate for the full definition of done is **40–60 hours**. The user chose to extend the calendar to roughly fifteen working days rather than cut CSV import. The day headings below are therefore **phases, not calendar days**.

**Sequencing note.** The first production deployment moves *forward* into the foundation phase as a gated production candidate. Deploying for the first time on launch day is the single largest schedule risk in the original plan.

### Phase 0 - safety and baseline (~3–4h)

- **Leave v1 running and writable.** Do not put it into maintenance mode and do not rebuild it: it pins Node `18.12.1`, which is EOL and unsupported on Heroku, so a rebuild may fail. Its unauthenticated note endpoints are a known, accepted, time-boxed exposure; freeze the code, do not publish endpoint details, and close the hole at cutover.
- Take the two backup artifacts described in §3 (DR backup run by the user; sanitized export for migration work). Record the checksum and source counts — expect 34 users and 33 notes.
- **Plan** removal of stored Spotify tokens and rotation of the Spotify client secret; **execute only at retirement.** Rotating earlier breaks live v1, which still reads `CLIENT_SECRET` and refreshes tokens. The report's "rotate before public invitation" wording is superseded.
- Record the v1 behavior with screenshots and a short architecture note.
- Reconcile this file and `CLAUDE.md` with the current decisions and commit them **before** any application code.
- Confirm that legacy-note import remains post-core unless the user explicitly changes its priority.

Exit criteria: committed instructions are internally consistent, legacy data is backed up, and `main` is protected.

### Phase 1 - foundation

- Scaffold Next.js with strict TypeScript.
- Configure formatting, linting, tests, and CI.
- Configure PostgreSQL and Prisma migrations.
- Implement the initial schema.
- Integrate Clerk email OTP and Google login.
- Implement local user upsert from verified auth subject.
- Add a redacted environment template and setup documentation.
- Seed data must cover the cases that are hard to picture in the abstract: a multi-artist track, the same recording twice in one collection, two users holding private notes on the same recording, an `origin = user` manual entry, a note carrying playlist context, and two snapshots of one collection.
- **Checkpoint 1a — hands-on local schema review.** Before any Managed PostgreSQL spend or droplet change, the user runs the app locally and browses the seeded model in Prisma Studio. Schema feedback lands here, at the cheapest possible moment.
- Provision DigitalOcean Managed PostgreSQL and make the **first gated deployment** to `v2.playlistnotes.io` (§15).

Exit criteria: a user can authenticate, a local user is created, migrations work from an empty database, CI passes, and the gated staging environment is live without affecting MKDb.

### Phase 2 - secure track-note vertical slice

- Parse Spotify track URLs without OAuth.
- Create or resolve a recording and external mapping.
- Create, list, edit, and delete a private note.
- Show provider metadata and an open/embed action.
- Add a user-entered metadata fallback and prove the workflow succeeds with no Spotify credentials and with oEmbed unavailable.
- Add owner authorization and cross-user negative tests.
- Add useful empty, loading, validation, and failure states.

Exit criteria: two test users are isolated, and one can paste a track link and manage a private note end to end.

### Phase 3 - collections and CSV import

- Implement Exportify-compatible CSV parsing, with entity linkage at ingest from the URI columns (§6, §8).
- Implement playlist-link capture as **provenance attached to a collection the user is creating** — it creates no collection and no items on its own (§4.4).
- Create collection snapshots with ordered items.
- Show import results and row-level errors.
- Add private collection pages.
- Add idempotency protection.

Exit criteria: a realistic CSV creates a correctly ordered collection, duplicates are preserved, and repeated import is handled deliberately.

### Phase 4 - sharing, search, and product polish

- Implement private/unlisted/public visibility.
- Add public note and collection pages with stable Playlistnotes URLs.
- Add user-scoped note search.
- Make the primary workflows responsive and accessible.
- Add a concise landing page explaining the provider-independent product.

Exit criteria: a user can intentionally share one note or collection without exposing private content.

### Phase 5 - production and invitation

- Promote the already-live gated deployment; do not deploy for the first time here.
- Use a separate process, environment, database, and role from MKDb.
- Verify TLS, headers, rate limits, database backups, and restore instructions.
- Add Sentry and PostHog when credentials are available.
- Run production smoke tests.
- Invite ten users and record the validation window.

Exit criteria: the complete core workflow works in production and product events can answer whether users return.

## 13. Product analytics

Track a deliberately small event vocabulary:

- `account_created`
- `music_source_added`
- `note_created`
- `note_updated`
- `collection_import_started`
- `collection_import_completed`
- `share_published`
- `return_note_created`

Do not send note bodies, private music metadata, email addresses, auth tokens, or imported files to analytics.

Primary measures:

- Activation: invited user creates a first note.
- Core retention: activated user creates another note on a later calendar day.
- Import completion: started CSV import reaches a usable collection.
- Sharing: activated user deliberately publishes an item.

The initial decision rule is qualitative and small-sample: invite approximately ten people and look for several independent returns. Do not claim product-market fit from this experiment.

## 14. Tests and quality gates

Required before production invitation:

- A note can be created and managed with **every** Spotify secret and OAuth variable absent.
- **A playlist link creates no collection and no items**; only a CSV or an explicit user action creates items.
- **No artist or album row is ever created from a name string**; a CSV import creates exactly one artist row per distinct Spotify artist URI.
- A manually entered recording is stored with `origin = user` and excluded from global resolution candidates; raw `Artist URI(s)` / `Album Artist URI(s)` lists are retained in `source_metadata`.
- A credential-bearing MongoDB dump is never committed, logged, placed in an agent-readable directory, or passed to a model.
- User-entered metadata cannot mutate another user's saved display or the shared canonical recording.
- Re-import cannot delete, silently retarget, or reorder items underneath an existing note.
- Concurrent auth upsert creates exactly one local user; account linking never relies on raw email equality.
- Cross-user note and collection operations fail **even when valid object UUIDs are supplied**.
- The staging hostname is gated and `noindex` from first deployment.
- Destructive database reset commands reject non-disposable targets.
- Heroku auto-deploy is disabled before `main` receives v2; apex TLS, auth, and DNS rollback are tested before traffic moves.
- Duplicate CSV rows yield two collection items but **one** recording; the same track imported across two CSVs yields **one** recording.
- Unit tests for URL parsing, normalization, CSV header mapping, and resolution decisions.
- Tests proving the core track-note flow passes with no Spotify Web API credentials and tolerates oEmbed failure.
- A test proving a pasted playlist URL creates zero inferred collection items.
- Tests proving repeated track capture and CSV import reuse the same exact `(provider, provider_id)` recording while duplicate CSV rows remain duplicate collection items.
- URL adapter tests covering unsupported schemes/hosts, redirects, response limits, and timeout/failure behavior.
- Database integration tests for uniqueness and transaction behavior.
- Authorization tests proving cross-user reads and mutations fail.
- Import tests covering duplicates, malformed rows, large-but-reasonable files, and repeated imports.
- An import test proving a completely invalid file creates no collection.
- Playwright happy path: sign in, add track, create note, edit note, publish unlisted, open public URL.
- Playwright privacy path: private note is unavailable to anonymous and different authenticated users.
- A privacy test proving publishing a collection does not implicitly expose a private contextual note.
- Accessibility checks for forms, dialogs, focus order, labels, contrast, and keyboard use.
- Production build and migration-from-empty check in CI.
- A production smoke test that does not mutate another user's data.

Every feature must include:

1. Validated input.
2. Server-side authorization.
3. Useful failure behavior.
4. Tests proportional to risk.
5. Documentation for new configuration or operational steps.

## 15. Deployment and scaling

Initial deployment — concrete facts for this environment:

- The droplet is **1 vCPU / 2 GB RAM / 50 GB disk** in NYC1, and **already runs MKDb**: pm2 processes `server` and `mankbot`, nginx proxying to Node on **`localhost:3000`**, PostgreSQL 16 local over a UNIX socket, Let's Encrypt TLS, and a weekly crontab. **Never modify MKDb's process, nginx ownership, database, role, files, or cron.**
- **GitHub Actions builds; the droplet only runs.** Use Next.js `output: 'standalone'` and rsync `.next/standalone`, `.next/static`, and `public`. A `next build` spike alongside MKDb and its local PostgreSQL risks the OOM killer taking out MKDb's database. Set Prisma `binaryTargets = ["native", "debian-openssl-3.0.x"]` so the CI-built query engine runs on Ubuntu.
- Playlistnotes binds **`127.0.0.1:3001`** under its own pm2 process named `playlistnotes`, with its own nginx virtual host and certificate.
- Copy MKDb's proven proxy configuration: forward `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`, and set `trust proxy` to one hop, or rate limiting will see every request as `127.0.0.1`.
- **DigitalOcean Managed PostgreSQL**, same region as the droplet, private-network host, droplet-only trusted sources, `sslmode=require` with DO's CA certificate, and a low Prisma `connection_limit` (the smallest node allows roughly 22 backends). If DO's PgBouncer pool is used, Prisma needs `DATABASE_URL` (pooled) **and** `DIRECT_URL` (direct) — migrations must not run through a transaction-mode pooler. Run `prisma migrate deploy` from the droplet, which is a trusted source.
- DNS is at **GoDaddy**. `v2.playlistnotes.io` is a plain A record to the droplet. At cutover the apex needs care: GoDaddy offers no ALIAS/ANAME record, so the apex is most likely using domain forwarding to `www`; verify in the panel and replace with plain A records for apex and `www`, removing the forwarding. Certbot replaces Heroku ACM.
- Keep user-uploaded binary assets out of the application filesystem; use object storage if attachments are later introduced.
- Add a health endpoint that checks application readiness without leaking secrets.
- Use structured logs and request correlation IDs.

Scale based on measurements, not user-count folklore. Monitor:

- request rate and p50/p95/p99 latency
- error rate
- Node CPU and memory
- database CPU, memory, storage, active connections, slow queries, and index usage
- import duration and failure rate
- external provider latency and rate limits

Likely early bottlenecks are external APIs, import work, search, and operational reliability, not PostgreSQL's row capacity. Do not add caching, queues, replicas, partitions, or separate search infrastructure until metrics justify them.

When background enrichment becomes meaningful, use a durable job mechanism and explicit retry/idempotency behavior. Do not make request handlers wait on MusicBrainz or Last.fm for note creation.

## 16. Explicit non-goals for the rescue sprint

- React Native or a native iOS application
- End-to-end encryption
- Billing and subscriptions
- Apple login
- Collaborative collections or real-time editing
- Automatic Spotify playlist synchronization
- General Spotify OAuth onboarding
- Full Last.fm history mirroring
- Full MusicBrainz database ingestion
- Recommendation or ranking algorithms
- Attachments and user-uploaded artwork
- Microservices, Kubernetes, Kafka, or a separate search cluster

When asked to add a non-goal during the sprint, record it in the backlog and explain which locked outcome would be displaced.

### Recorded backlog — deferred, not abandoned

These are wanted, and the schema is deliberately built to accommodate them. Recording them keeps them out of the sprint without losing them.

| Feature | What it will need | What already accommodates it |
| --- | --- | --- |
| **Artist pages / track pages** (Last.fm-shaped) | Merge tooling, `needs_review` admin view, redirect-preserving merges, UGC moderation policy, and the §3a.5 filter excluding `origin = user` recordings | `artists` + `artist_external_ids` + `recording_artists` linked at ingest; `merged_into_id`; `origin` |
| **Collaborative collections** | `collection_members` (role, invite flow) and a decision on snapshot ownership under multiple editors | `collections.owner_id` remains valid as creator/owner; membership is purely additive |
| **Album pages** | `album_artists` join table | Pure backfill from `Album Artist URI(s)` retained in `source_metadata` |
| **User-authored recordings joining global dedup** | Convergence threshold, promotion rules, a moderation touch | `origin`; `normalized_key` written from day one; identifier acquisition already promotes automatically |
| **Cross-provider enrichment** (MusicBrainz, Last.fm, Apple Music, Tidal, Wikipedia) | Async jobs, rate limiting, provider terms review | Adapter interface; `recording_external_ids`; ISRC captured at import |
| **LLM-assisted resolution** | Only for the `needs_review` residue, only once that queue is non-trivial | Provenance recorded on every resolution decision |

The §3a.3 sequencing rule applies to all of them: the release that first shows one recording to many users carries the merge and moderation tooling with it.

## 17. Documentation and resume evidence

Maintain the following as implementation proceeds:

- `README.md`: product, local setup, validation, deployment overview
- `docs/architecture.md`: boundaries, data flow, major decisions
- `docs/data-model.md`: tables, identifiers, visibility rules, resolution logic
- `docs/security.md`: auth model, authorization invariants, secrets, threat assumptions
- `docs/runbook.md`: deploy, backup, restore, rollback, incident checks
- `docs/migration-status.md`: current phase and exit criteria, completed behavior, validation results, decisions, risks, and exact next vertical slice
- Architecture decision records for material choices
- A changelog or release notes for public iterations

Collect truthful evidence that can later support the resume:

- invited and activated users
- notes created
- later-day returns
- import size and completion rate
- API latency and error rate
- security and reliability tests
- deploy frequency and incident/restore exercises

Never manufacture metrics. Use placeholders in drafts until measurements exist.

The valuable hiring story is not “migrated MongoDB to PostgreSQL.” It is:

> Re-architected a Spotify-dependent prototype into a secure, provider-independent, multi-tenant product; designed cross-provider music identity and import workflows; shipped public/private sharing; operated it in production; and measured whether users returned.

## 18. Agent execution protocol

At the start of implementation:

1. Read this file and `CLAUDE.md` if present.
2. Inspect repository instructions, status, package manifests, environment examples, tests, and deployment docs.
3. Report any user changes in the working tree and preserve them.
4. Create or update a short execution plan with one in-progress item.
5. Implement the smallest end-to-end increment for the current sprint day.
6. Run targeted tests, then broader validation proportional to the change.
7. Update documentation and record follow-up work.
8. Update `docs/migration-status.md` so a fresh agent can resume without reconstructing the migration from chat history.
9. Summarize the user-visible outcome, validation performed, and any remaining risk.

Do not perform a broad rewrite in one unreviewable commit. Prefer vertical, testable increments. Do not claim a phase is complete until its exit criteria pass.

## 19. Definition of v2 rescue complete

The rescue is complete when all of the following are true:

- New users can sign in without Spotify.
- Core acceptance tests pass with no Spotify Client ID, secret, access token, refresh token, OAuth callback, or Spotify SDK configured.
- A user can paste a Spotify track link and create a private note.
- A pasted public Spotify playlist link creates **no collection and no collection items**; it only attaches provenance to a collection the user is deliberately creating.
- A user can import an Exportify-compatible CSV into an ordered collection.
- Each music entry has a Playlistnotes UUID and external identifier mappings, and artists and albums are linked from provider IDs rather than name strings.
- Notes and collections enforce owner authorization on the server.
- A user can intentionally create a stable unlisted or public share URL.
- Publishing a collection does not implicitly publish any private note body.
- Private content is absent from anonymous and cross-user access.
- Core behavior has automated tests.
- CI passes and production has monitoring and verified backups.
- Approximately ten people can be invited without Spotify developer onboarding.
- The application records enough privacy-safe events to observe first-note activation and later-day return.

Everything else belongs to the next product decision.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
