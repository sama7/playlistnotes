# v2 planning archive

## Contract precedence

1. **`/AGENTS.md`** — the authoritative, model-agnostic implementation contract.
2. **`/CLAUDE.md`** — a Claude Code adapter for that contract. It never overrides `AGENTS.md`.
3. **`trackjot-v2-report.html`** (this directory) — narrative rationale. **Non-normative.**

## About the report

`playlistnotes-v2-report.html` is the original product-rescue report, revised August 6, 2026. It is preserved as the record of *why* v2 exists: the Spotify Development Mode constraint, the PostgreSQL-versus-MongoDB reasoning, the career framing, and the original ten-day sprint.

**It predates the August 7, 2026 reconciliation and disagrees with `AGENTS.md` in several places.** Where they differ, `AGENTS.md` wins. The known divergences:

| Report says | Current contract |
| --- | --- |
| Ten-day sprint, 20–30 hours | ~15 working days; realistic estimate 40–60 hours |
| First deployment on the last day | First gated deployment during the foundation phase |
| Put v1 into maintenance/read-only mode on day zero | v1 stays running and writable; the exposure is a known, accepted, time-boxed tradeoff closed at cutover |
| Rotate the Spotify client secret before public invitation | Rotate at retirement only — v1 still reads it |
| A playlist link creates a collection reference with zero items | A playlist link creates **no collection and no items**; it is provenance on a collection the user is creating |
| One MongoDB export | Two artifacts: a credential-bearing DR dump an agent never opens, and a sanitized migration export |

Do not edit the report to match. It is a dated artifact; the divergences above are the changelog.

## Source of record

The pristine originals live outside this repository at `~/Documents/trackjot-v2/`. The copies here are the reconciled, authoritative versions.
