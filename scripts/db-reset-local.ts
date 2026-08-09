/**
 * Guarded wrapper around `prisma migrate reset`.
 *
 * A bare `npx prisma migrate reset` inherits whatever DATABASE_URL happens to
 * be configured, which is how someone wipes a production candidate by accident.
 * This fails CLOSED: it refuses to run unless every assertion below holds.
 *
 * Production never resets. It runs `prisma migrate deploy` against reviewed
 * migrations, and nothing else.
 */

import { spawnSync } from "node:child_process";

// Unlike the Prisma CLI, tsx does not read .env. Load it when present; in CI
// the environment supplies these directly and there is no file to read.
try {
  process.loadEnvFile();
} catch {
  // no .env on disk — fall through to the assertions below
}

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres", "db"]);
const ALLOWED_DB_SUFFIXES = ["_dev", "_test"];

function fail(reason: string): never {
  console.error(`\n✖ Refusing to reset the database.\n  ${reason}\n`);
  process.exit(1);
}

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) fail("DATABASE_URL is not set.");

if (process.env.NODE_ENV === "production") {
  fail("NODE_ENV is 'production'.");
}

let url: URL;
try {
  url = new URL(rawUrl);
} catch {
  fail("DATABASE_URL is not a parseable URL.");
}

const host = url.hostname;
const database = url.pathname.replace(/^\//, "");

if (!ALLOWED_HOSTS.has(host) && process.env.CI !== "true") {
  fail(
    `Host '${host}' is not a local host and CI is not set. ` +
      `Allowed: ${[...ALLOWED_HOSTS].join(", ")}.`,
  );
}

if (!ALLOWED_DB_SUFFIXES.some((suffix) => database.endsWith(suffix))) {
  fail(
    `Database '${database}' does not end in ${ALLOWED_DB_SUFFIXES.join(" or ")}. ` +
      `Disposable databases must be named explicitly.`,
  );
}

console.log(`Resetting disposable database '${database}' on '${host}'…`);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "reset", "--force", "--skip-generate"],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
