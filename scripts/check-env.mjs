#!/usr/bin/env node
/**
 * Validate the *shape* of a deployed environment file. Never prints a value.
 *
 * This exists because of a silent failure that a smoke test could not catch.
 * The first deployment copied secrets from a local file with `grep`, which is
 * line-based — so the multi-line Apple private key arrived truncated: a BEGIN
 * marker, no END, 94 of 261 bytes. Nothing complained. The app started, served
 * every page, passed every check, and Apple Music was simply broken, because
 * the failure only surfaces inside a signing call that no anonymous request
 * makes.
 *
 * The general lesson is that a secret can be *present* and *wrong*, and
 * presence is all a `[ -n "$VAR" ]` check ever proves. So these rules assert
 * structure: a PEM has both markers, a key has a plausible length, a URL parses.
 *
 * Values are never printed, logged, or included in an error. Failures name the
 * variable and describe the shape that was expected.
 *
 * Usage: node scripts/check-env.mjs [path-to-env]   (default ./.env)
 */

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? ".env";

/**
 * Parses `KEY=value`, including a double-quoted value spanning several physical
 * lines — which is exactly the case that broke, so parsing it correctly here is
 * the point rather than an incidental nicety.
 */
function parseEnv(text) {
  const out = {};
  const re = /^([A-Za-z_][A-Za-z0-9_]*)=(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))$/gm;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

const isPem = (v) =>
  v.includes("BEGIN PRIVATE KEY") &&
  v.includes("END PRIVATE KEY") &&
  // Real newlines or escaped ones; both are valid on disk.
  (v.includes("\n") || v.includes("\\n")) &&
  v.length > 200;

const isUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const isPgUrl = (v) => v.startsWith("postgres://") || v.startsWith("postgresql://");

/** [name, required, predicate, expectation] */
const RULES = [
  ["DATABASE_URL", true, isPgUrl, "a postgres:// or postgresql:// URL"],
  ["DIRECT_URL", false, isPgUrl, "a postgres:// or postgresql:// URL"],
  ["APP_BASE_URL", true, isUrl, "an absolute http(s) URL"],
  [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    true,
    (v) => /^pk_(test|live)_/.test(v),
    "a key starting pk_test_ or pk_live_",
  ],
  [
    "CLERK_SECRET_KEY",
    true,
    (v) => /^sk_(test|live)_/.test(v) && v.length > 30,
    "a key starting sk_test_ or sk_live_",
  ],
  ["SPOTIFY_CLIENT_ID", false, (v) => v.length === 32, "32 hex characters"],
  ["SPOTIFY_CLIENT_SECRET", false, (v) => v.length === 32, "32 hex characters"],
  ["APPLE_TEAM_ID", false, (v) => /^[A-Z0-9]{10}$/.test(v), "a 10-character Team ID"],
  ["APPLE_MUSIC_KEY_ID", false, (v) => /^[A-Z0-9]{10}$/.test(v), "a 10-character Key ID"],
  [
    "APPLE_MUSIC_PRIVATE_KEY",
    false,
    isPem,
    "a complete PKCS#8 PEM — BOTH begin and end markers, over 200 bytes",
  ],
];

const env = parseEnv(readFileSync(path, "utf8"));
let failed = 0;
let skipped = 0;

console.log(`Checking the shape of ${path} (values are never printed)\n`);

for (const [name, required, ok, expectation] of RULES) {
  const value = env[name];

  if (value === undefined || value === "") {
    if (required) {
      console.log(`  MISSING  ${name.padEnd(34)} required`);
      failed++;
    } else {
      console.log(`  skip     ${name.padEnd(34)} not configured (optional)`);
      skipped++;
    }
    continue;
  }

  if (ok(value)) {
    console.log(`  ok       ${name.padEnd(34)} ${value.length} chars`);
  } else {
    console.log(`  MALFORMED ${name.padEnd(33)} ${value.length} chars — expected ${expectation}`);
    failed++;
  }
}

/**
 * Apple's three variables are useless individually. A partial set means someone
 * copied some and not others, which is precisely the state the first deployment
 * was left in — and it reads as "Apple is not configured" rather than as the
 * error it is.
 */
const apple = ["APPLE_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"];
const present = apple.filter((k) => env[k]);
if (present.length > 0 && present.length < apple.length) {
  console.log(
    `\n  INCOMPLETE Apple Music: ${present.length}/3 set. Missing ${apple
      .filter((k) => !env[k])
      .join(", ")}. Apple features will fail at call time, not at startup.`,
  );
  failed++;
}

console.log(
  `\n${failed === 0 ? "All configured variables are well-formed" : `${failed} problem(s)`}` +
    `${skipped ? `, ${skipped} optional not configured` : ""}.`,
);
process.exit(failed === 0 ? 0 : 1);
