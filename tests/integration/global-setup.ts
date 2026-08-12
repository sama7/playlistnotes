import { execFileSync } from "node:child_process";

/**
 * Apply the migration history to the disposable test database once per run.
 *
 * `migrate deploy` rather than `migrate reset`: deploy is additive and is the
 * same command production uses, so CI exercises the real path. The guard in
 * vitest.integration.config.ts has already refused anything not named *_test.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Create a disposable database " +
        "(createdb trackjot_test) and set it in .env.",
    );
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
