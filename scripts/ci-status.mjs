#!/usr/bin/env node
/**
 * CI status for one exact commit.
 *
 * ## Why this script exists
 *
 * Two failures, in the same afternoon, both mine.
 *
 * **I reported CI as passing when it had failed.** I read the workflow *badge*
 * while the run for that commit was still in progress, and a badge reports the
 * last completed run for a branch — not the run for the commit you are asking
 * about. So it showed the previous commit's green and I relayed it as this
 * one's. The lesson is not "be careful with badges": it is that a branch-shaped
 * question can never answer a commit-shaped one. This script only ever resolves
 * runs by `head_sha`, and when there is no run for that SHA yet it says so
 * rather than falling back to anything.
 *
 * **I exhausted the API rate limit.** Unauthenticated api.github.com allows 60
 * requests an hour per IP, `gh` is not installed on this machine, and I polled
 * across several loops until there was nothing left — which is what pushed me
 * to the badge in the first place. So the two failures were one failure. Every
 * response's `x-ratelimit-remaining` is read here, polling stops before the
 * budget is gone rather than after, and the request count is capped regardless.
 *
 * Usage:
 *   node scripts/ci-status.mjs                # HEAD, one look
 *   node scripts/ci-status.mjs --wait         # poll until the run completes
 *   node scripts/ci-status.mjs <sha> --wait
 *
 * Exit codes: 0 success · 1 failure/cancelled · 2 still running · 3 no run for
 * that SHA · 4 refused to poll (budget) or the request itself failed.
 */

import { execFileSync } from "node:child_process";

/** Stop this far above empty, so a later check is always still possible. */
const RESERVE = 10;
/** A hard ceiling on requests per invocation, independent of the budget. */
const MAX_REQUESTS = 12;
const FIRST_DELAY_MS = 15_000;
const MAX_DELAY_MS = 90_000;

const args = process.argv.slice(2);
const wait = args.includes("--wait");

function git(...a) {
  // stderr piped rather than inherited, so a failed rev-parse produces this
  // script's own message instead of git's usage text ahead of it.
  return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Always a full 40-character SHA.
 *
 * GitHub's `head_sha` filter does no prefix matching: an abbreviated SHA
 * matches nothing and the API answers with an empty list, which this script
 * would then report as "no workflow run exists" — confidently, and wrongly,
 * about a run that was sitting right there in progress. That is the precise
 * failure this script was written to prevent, so it had better not commit it
 * itself. Anything git can resolve — a short SHA, a tag, `HEAD~2`, a branch —
 * is resolved before it is asked about.
 */
const requested = args.find((a) => !a.startsWith("--")) ?? "HEAD";
let sha;
try {
  sha = git("rev-parse", requested);
} catch {
  console.error(`Not a ref this repository knows: ${requested}`);
  process.exit(4);
}
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`Could not resolve ${requested} to a full commit SHA.`);
  process.exit(4);
}

/** owner/repo from whichever remote this repo actually uses — here it is
 *  `github`, not `origin`, and hardcoding either would be a trap. */
function repoSlug() {
  const remotes = git("remote").split("\n").filter(Boolean);
  for (const name of ["github", "origin", ...remotes]) {
    if (!remotes.includes(name)) continue;
    const url = git("remote", "get-url", name);
    const match = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  }
  throw new Error("No GitHub remote found.");
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
let requests = 0;
let remaining = null;

async function api(path) {
  if (requests >= MAX_REQUESTS) {
    throw new Budget(`Request cap reached (${MAX_REQUESTS}). Not polling further.`);
  }
  if (remaining !== null && remaining <= RESERVE) {
    throw new Budget(
      `Rate limit budget down to ${remaining}. Stopping while some is left.` +
        (token ? "" : " Set GITHUB_TOKEN — unauthenticated is only 60/hour."),
    );
  }

  requests += 1;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "trackjot-ci-status",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  const header = response.headers.get("x-ratelimit-remaining");
  if (header !== null) remaining = Number(header);

  if (response.status === 403 && remaining === 0) {
    throw new Budget("Rate limit is already exhausted. Wait for the window to reset.");
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${path}`);
  }
  return response.json();
}

class Budget extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const slug = repoSlug();
  let delay = FIRST_DELAY_MS;

  for (;;) {
    // Runs for THIS commit. Never a branch, never a badge.
    const body = await api(
      `/repos/${slug}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
    );
    const runs = body.workflow_runs ?? [];

    if (runs.length === 0) {
      console.log(`No workflow run exists for ${sha.slice(0, 7)} yet.`);
      if (!wait) process.exit(3);
    } else {
      const done = runs.every((r) => r.status === "completed");
      const summary = runs
        .map((r) => `  ${r.name}: ${r.status}${r.conclusion ? ` → ${r.conclusion}` : ""}`)
        .join("\n");

      if (done) {
        const bad = runs.filter((r) => r.conclusion !== "success");
        console.log(`CI on ${sha.slice(0, 7)} (${requests} request(s), ${remaining ?? "?"} left):`);
        console.log(summary);
        if (bad.length > 0) {
          for (const r of bad) console.log(`\n  ${r.name} → ${r.conclusion}: ${r.html_url}`);
          process.exit(1);
        }
        process.exit(0);
      }

      console.log(`CI on ${sha.slice(0, 7)} is still running:`);
      console.log(summary);
      if (!wait) process.exit(2);
    }

    await sleep(delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}

main().catch((error) => {
  console.error(error instanceof Budget ? `Refusing to continue: ${error.message}` : error.message);
  process.exit(4);
});
