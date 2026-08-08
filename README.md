# Playlistnotes

A place to keep what music means to you — the details, the trivia, the memory attached to a song. Notes belong to you, are private by default, and are shared only when you deliberately share them.

**This branch is v2, a rewrite in progress.** v1 — Express, Create React App, MongoDB, and Spotify OAuth — still runs in production on `main` and is untouched. See [`docs/migration-status.md`](docs/migration-status.md) for where the migration currently stands.

## Why v2 exists

Spotify's Web API caps an app in Development Mode at five authenticated Spotify users, and Extended Quota requires a registered business with at least 250,000 monthly active users. v1 made Spotify identity *be* Playlistnotes identity, so it cannot onboard anyone new.

v2 inverts that. **Playlistnotes owns its accounts, notes, collections, privacy rules, public URLs, and internal music identifiers.** Spotify becomes one optional source among many: paste a track link and write a note, with no Spotify login anywhere in the flow. The core acceptance suite must pass with no Spotify credentials configured at all.

## Stack

- Next.js App Router, React, strict TypeScript, Node 24
- PostgreSQL 16+ with Prisma
- Clerk for authentication (email one-time code and Google)
- Zod at every server boundary
- Vitest and Playwright
- GitHub Actions for verification and for building the deployable artifact

## Local setup

```bash
nvm use                       # Node 24
npm install

createdb playlistnotes_dev    # disposable; recreated from migrations + seed
createdb playlistnotes_test   # disposable; used by the integration suite

cp .env.example .env.local    # then fill in values
npm run db:migrate            # apply migrations
npm run db:seed               # synthetic data covering the awkward cases

npm run dev                   # http://localhost:3100
npm run db:studio             # browse the model
```

The local database is deliberately disposable — recreate it any time with `npm run db:reset:local`, which refuses to run against anything that is not a local `*_dev` or `*_test` database.

## Validation

```bash
npm run typecheck
npm run lint
npm test                 # unit
npm run test:integration # database-backed: authorization, uniqueness, transactions
npm run test:e2e         # Playwright
npm run build
npx prisma migrate status
```

## Repository conventions

- [`AGENTS.md`](AGENTS.md) is the authoritative implementation contract.
- [`CLAUDE.md`](CLAUDE.md) adapts it for Claude Code and never overrides it.
- [`docs/v2-plan/`](docs/v2-plan/) archives the original product report as non-normative rationale.
- `main` is **frozen**: it auto-deploys v1 to Heroku. Never push or merge to it without an explicit cutover decision.

## License

GPL-3.0-or-later. See [LICENSE.txt](LICENSE.txt).
