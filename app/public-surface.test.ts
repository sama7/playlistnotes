import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Routes the proxy treats as public must not read the database directly.
 *
 * The Checkpoint 1a landing page did. It listed every recording, collection and
 * note in the database — other people's private notes included — and `/` is a
 * public route, so anyone could have read them. Locally, against seeded fiction,
 * that was the point of the page. Deployed, it was a disclosure waiting for the
 * first real note.
 *
 * This is a source-level guard, and it is worth being precise about what that
 * buys. It cannot prove a route is safe; it proves a specific, repeatable
 * mistake did not come back — a page that reaches for `prisma` and renders
 * whatever it finds, with no owner in the WHERE clause. The real authorization
 * boundary is owner-scoped queries, covered by the cross-user denial tests in
 * tests/integration.
 *
 * The share routes are excluded deliberately: they must query, and what makes
 * them safe is filtering on visibility and share token, not abstention.
 */

const MUST_NOT_QUERY = [
  { file: "page.tsx", why: "the public landing page" },
  { file: "sign-in/[[...sign-in]]/page.tsx", why: "the sign-in page" },
  { file: "sign-up/[[...sign-up]]/page.tsx", why: "the sign-up page" },
];

const appDir = fileURLToPath(new URL(".", import.meta.url));

describe("public routes", () => {
  for (const { file, why } of MUST_NOT_QUERY) {
    it(`${why} does not read the database`, async () => {
      const source = await readFile(`${appDir}${file}`, "utf8");
      expect(source).not.toMatch(/from\s+["']@\/lib\/db["']/);
      expect(source).not.toMatch(/\bprisma\./);
    });
  }
});
