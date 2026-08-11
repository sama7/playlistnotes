# Playlistnotes

A place to keep what music means to you — the detail, the trivia, the memory
attached to a song. Notes belong to you, are private by default, and are shared
only when you deliberately share them.

**This branch is v2, a rewrite.** v1 — Express, Create React App, MongoDB, and
Spotify OAuth — still runs in production on `main` and is untouched.
Current state: [`docs/migration-status.md`](docs/migration-status.md).
Operations: [`docs/runbook.md`](docs/runbook.md).
The implementation contract: [`AGENTS.md`](AGENTS.md).

---

## Why v2 exists

Spotify's Web API caps an app in **Development Mode at five authenticated
users**. Extended Quota requires a launched service with roughly 250,000 monthly
actives — not a threshold a side project clears.

v1 made Spotify identity *be* Playlistnotes identity. It holds 20 grandfathered
users from when the cap was higher, and **it cannot onboard a twenty-first**.
That is not a bug to fix; it is the architecture.

v2 inverts the relationship. **Playlistnotes owns its accounts, notes,
collections, privacy rules, public URLs, and internal music identifiers.**
Spotify becomes one optional source among several. The core acceptance suite
passes with no Spotify credentials configured at all, and CI enforces that by
never setting them.

## The insight the rewrite turned on

The five-user cap counts **Spotify-authenticated users**. It has nothing to say
about how an *application* reads public data.

Spotify's **Client Credentials** flow authenticates the application rather than
a person. It costs nothing against the cap, and `/v1/tracks/{id}` returns the
track name, every artist with their own ID, the album with its ID, the duration,
and the ISRC.

The original plan had recorded, as settled fact, that playlist contents were
unreadable without a user login. Testing it disproved that: **user-created
public playlists enumerate fine** — verified against three playlists from three
different owners, at 4, 42, and 50 tracks. Only Spotify's *own editorial*
playlists (`37i9…`) return 404 to a Development Mode app.

That single finding produced the largest feature in the product, and it is why
the name means something again: Playlistnotes annotates playlists, without
anyone logging into Spotify.

## What it does

**Paste a link, get the music.** Spotify and Apple Music track, album, and
playlist links all resolve. A track link writes a note; an album or playlist link
imports the whole thing as a collection. You are never asked which service a link
came from or what kind of thing it is — the server works that out.

**Annotate a playlist track by track.** A note can be anchored to a *collection
item*, so "this song, third into this playlist" is a different statement from
"this song".

**Private by default.** Notes and collections start private. Sharing is
deliberate, one item at a time, and **publishing a collection never publishes the
notes inside it**.

**Search and tag.** Full-text search over what you wrote and the track it was
about. Tags are scoped per user, so your vocabulary is yours.

**Import a CSV.** For the two things no API will serve: your private playlists,
and Spotify's editorial ones.

## Provider capabilities — measured, not assumed

Every row here was verified against the live API rather than inferred from
documentation.

| | Spotify | Apple Music |
| --- | --- | --- |
| Track by link | yes, full metadata + ISRC | yes, no account needed |
| Album by link | yes | yes, no account needed |
| **User-created public playlist** | **yes** | yes (developer token) |
| **Editorial playlist** | **no** — 404 in Development Mode | **yes** |
| Artists as separate entities | yes | catalog API only; iTunes flattens them |
| ISRC | yes | catalog API only |
| Account required | none (Client Credentials) | none for tracks/albums; paid for playlists |
| Private playlists | no | no |

Two asymmetries worth keeping in mind: Spotify withholds its editorial playlists
from small apps and Apple does not; and Apple's *public* iTunes lookup collapses
"PARTYNEXTDOOR & Drake" into one credit string with one artist id, while its
catalog API returns both artists properly. The importer never splits a credit
string to make up the difference — see below.

## Decisions worth explaining

### Identity comes from identifiers, never from names

An artist or album row is **only ever created from a provider ID**. Never from a
name string.

The reason is a single example. Exportify CSVs carry both `Artist URI(s)` and
`Artist Name(s)`. The URI column splits on commas unambiguously, because a
Spotify URI contains no comma. The name column does not: **"Tyler, The Creator"**
is one artist whose name contains a comma, and no amount of string cleverness
distinguishes that from two artists. The URI is what proves it.

So one URI claims the whole name field however many commas it holds; several
URIs take names positionally; and a length mismatch abandons the names rather
than attaching the wrong one to the right entity. A wrong name is a cosmetic
bug. A wrong entity is a false merge, and **a false merge is worse than a
duplicate** — a duplicate is invisible while notes are private and fixable later
with `merged_into_id`, while a false merge silently attaches one person's writing
to the wrong song and cannot be safely undone.

### The database is consulted before any provider call

Not an optimisation. It is the rate-limit guarantee: a track anyone has captured
before resolves with **zero** network calls, so provider requests scale with how
fast the catalog grows rather than with how much the product is used. That is a
much flatter curve, and it is what makes a shared Development Mode quota
survivable.

Because it is load-bearing, `no-network-on-known-track.test.ts` counts provider
calls directly — and counts *both* the Web API and oEmbed paths, since counting
one would let the other escape the guarantee on exactly the machines where it is
active.

### Every import is an immutable snapshot

Re-importing a playlist creates a **new** collection rather than mutating the
old one. Notes are anchored to collection items, so mutating items in place
would silently retarget somebody's writing to a different song. There are tests
that re-import with the order reversed and assert the original note is still on
its original item at its original position.

### Publishing a collection cannot leak a private note

This is structural, not filtered. `getSharedCollection` selects a narrow,
explicit shape that does not include the notes relation **at all** — so there is
nothing on the shared page to accidentally render. A filter is something a later
query can forget to apply; an absent relation is not.

The tests search the serialised payload for the note's text rather than asserting
on object shape, so an `include` added later fails there instead of shipping.

### Entry is lax; the shared catalog is not

A music journal has to hold the mp3 a friend sent and the vinyl-only B-side, so
free-text entry is allowed. Safety comes from tiering rather than gatekeeping: a
recording is either **provider-anchored** or **user-authored**, and user-authored
rows stay scoped to their creator and out of global resolution. One person's
free text is never auto-promoted into a shared entity.

## Architecture

```
app/                     Next.js App Router — pages and server actions
lib/
  music/
    capture-track.ts     one pasted link -> one recording, either provider
    persist-track.ts     the single definition of a provider-anchored recording
    import-collection.ts album/playlist/CSV -> an immutable snapshot
    importable.ts        the provider-neutral shape the importer works in
    spotify/ apple/ csv/ adapters; nothing downstream branches on provider
  notes/                 owner-scoped services: notes, search, tags
  collections/           sharing, and the narrow shared-view shape
proxy.ts                 the route gate (Next 16 renamed middleware -> proxy)
scripts/                 production entry point, smoke test, env validation
deploy/                  nginx vhost and the backup/restore scripts
```

The rules that keep it navigable: domain logic never imports React or HTTP;
provider code lives behind adapters; **`ownerId` is always the first argument and
always comes from the verified session**, never from client input.

## Security posture

- **Ownership is enforced in the WHERE clause**, never as a post-fetch check. A
  valid UUID belonging to someone else returns the same "not found" a deleted
  row does.
- **Cross-user denial is tested with valid identifiers.** A malformed id proves
  nothing — it fails parsing, not authorization.
- **Link parsing is the SSRF boundary.** Allowlisted hosts, look-alike domains
  refused, loopback and link-local addresses refused, non-http schemes refused —
  before any network call is contemplated.
- **No Spotify user OAuth exists**, and CI greps for its surface on every push.
- Secrets are never committed; `check-env.mjs` validates their *shape* on the
  server without ever printing a value.

## Running it

```bash
nvm use                       # Node 24
npm ci
cp .env.example .env.local    # DATABASE_URL and Clerk keys are required
npm run db:migrate
npm run db:seed
npm run dev                   # http://localhost:3100
```

Provider credentials are optional. Without them capture degrades to
title-only lookup and asks you for the artist — a path the test suite exercises
deliberately, because it is the guarantee that the product does not depend on
any provider.

## Verifying

```bash
npm run typecheck
npm run lint
npm test                      # unit
npm run test:integration      # against a disposable local database
npm run build
npm run smoke <url>           # real requests to a running server
E2E_BASE_URL=<url> npm run test:e2e
```

A pre-push hook runs the first four and blocks the push on failure. It exists
because a push once went out with a failing test, after a shell chain used `;`
where it needed `&&`. Remembering is not a control; a hook is.

### A green build proves less than it looks like

On 2026-08-10 the whole suite passed, `next build` succeeded, pm2 reported
`online` — and **every rendering route hung for 30 seconds and then 500'd.**

Next builds a per-request URL from the hostname it starts with, but internally
normalises *any* loopback hostname (127.0.0.1 included) to the literal string
`localhost`. Clerk's middleware sets a rewrite header to that URL on every
request. Next relativises the rewrite against the original; started with
`HOSTNAME=127.0.0.1` the two origins disagree, so Next classified its own rewrite
as **external** and proxied every request to itself.

Nothing that runs before a server boots can see that. So `scripts/smoke.js` makes
real requests to the built artifact, CI runs it against the package it is about
to upload, and it runs again after every deploy. It was verified to fail — with a
non-zero exit — against exactly that regression before being trusted.

The same lesson landed twice. The first deployment copied secrets with `grep`,
which is line-based, so a multi-line private key arrived truncated: begin marker,
no end marker, 94 of 261 bytes. The app started, served every page, passed every
check, and Apple Music was quietly broken — the failure only surfaces inside a
signing call no anonymous request makes. **A secret can be present and wrong, and
presence is all an "is it set?" check ever proves.** `check-env.mjs` now asserts
shape.

## Deployment

GitHub Actions builds the artifact; the droplet only runs it. A `next build`
spike alongside the co-tenant application and its PostgreSQL on a 2 GB box risks
the OOM killer taking out a database that is not ours.

The app binds `127.0.0.1:3001` behind nginx with Let's Encrypt TLS and HSTS.
Backups run hourly: verified complete rather than truncated, encrypted **before**
leaving the box, mirrored to object storage, 24 hourly plus 30 daily — and the
restore path is rehearsed end to end, including a download-from-remote-only
restore, because a backup nobody has restored is a hypothesis.

## Status

Roughly three quarters of the way to a public release. **240+ tests**: unit,
integration against a real PostgreSQL, and Playwright against the deployed host.
Live, gated, and `noindex` at `v2.playlistnotes.io`.

Remaining before an invite: an auth-provider migration, signed-in browser specs,
and an accessibility pass. Details and estimates in
[`docs/migration-status.md`](docs/migration-status.md).
