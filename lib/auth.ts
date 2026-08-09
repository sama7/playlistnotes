import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { User } from "@prisma/client";

/**
 * Resolving the acting user.
 *
 * Two invariants from AGENTS.md §9, both load-bearing:
 *
 *   1. The acting identity comes ONLY from the verified server session. No
 *      route, Server Action, import, or legacy mapping may accept a
 *      Playlistnotes user ID from client input. This is the defect that made
 *      v1's note endpoints world-writable.
 *   2. Concurrent first requests for one verified subject must create exactly
 *      ONE local row.
 *
 * On (2): Prisma's `upsert` is find-then-create and races — two simultaneous
 * first requests can both miss and both insert, and one gets a unique
 * violation. `INSERT … ON CONFLICT` pushes the race into PostgreSQL, where the
 * unique index on auth_subject settles it atomically.
 *
 * Clerk webhooks are deliberately not used. The row is created lazily here on
 * first authenticated request, which removes an endpoint, a signature check,
 * and an idempotency problem from the sprint.
 */

/** The verified Clerk subject, or null when signed out. */
export async function currentAuthSubject(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * Resolve the local user for a verified subject, creating it on first sight.
 *
 * Fast path is a plain SELECT — the insert only runs the first time a given
 * subject is seen, so steady-state traffic performs no writes here.
 */
export async function resolveLocalUser(authSubject: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { authSubject } });
  if (existing) return existing;

  // DO UPDATE rather than DO NOTHING: on conflict, DO NOTHING returns no rows
  // and would need a second round trip. Touching updated_at makes RETURNING
  // fire on both the insert and the conflict path.
  const rows = await prisma.$queryRaw<User[]>`
    INSERT INTO users (id, auth_subject, created_at, updated_at)
    VALUES (gen_random_uuid(), ${authSubject}, now(), now())
    ON CONFLICT (auth_subject)
      DO UPDATE SET updated_at = users.updated_at
    RETURNING
      id,
      auth_subject   AS "authSubject",
      username,
      display_name   AS "displayName",
      avatar_url     AS "avatarUrl",
      created_at     AS "createdAt",
      updated_at     AS "updatedAt"
  `;

  const user = rows.at(0);
  if (!user) {
    // Unreachable: ON CONFLICT DO UPDATE always returns a row.
    throw new Error("Failed to resolve local user.");
  }
  return user;
}

/**
 * The acting user for a request that requires authentication.
 *
 * Throws when signed out. Route handlers translate that into a non-disclosing
 * response — never one that reveals whether a resource exists.
 */
export async function requireUser(): Promise<User> {
  const authSubject = await currentAuthSubject();
  if (!authSubject) throw new UnauthenticatedError();
  return resolveLocalUser(authSubject);
}

/** The acting user, or null when signed out. For pages that render both ways. */
export async function optionalUser(): Promise<User | null> {
  const authSubject = await currentAuthSubject();
  return authSubject ? resolveLocalUser(authSubject) : null;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated.");
    this.name = "UnauthenticatedError";
  }
}
