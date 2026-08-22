import { prisma } from "@/lib/db";

/**
 * Usernames.
 *
 * They exist now rather than later for one reason: the moment TrackJot has any
 * social surface — following, tagging someone in a note, a public profile — it
 * needs a stable handle, and retrofitting one onto an existing user base means
 * asking everybody to pick a name at once while the good ones are taken in a
 * stampede. Claiming a handle early costs a field; claiming it afterwards costs
 * a migration and a bad week.
 *
 * The rules are deliberately narrow, and each one is a decision:
 *
 *   - **Lowercased on the way in.** The column is a plain unique index, so case
 *     folding in the application is what makes `Samah` and `samah` the same
 *     person without a citext extension.
 *   - **Letters, digits, underscore; 3–30.** No dots and no hyphens: both invite
 *     confusable pairs (`a.b` / `ab`), and a handle whose job is to identify a
 *     person should be hard to impersonate.
 *   - **Route names are reserved.** A profile is going to live at `/@name` or
 *     `/name`; letting someone take `settings` now is a problem that only
 *     surfaces the day that route ships.
 */

const SHAPE = /^[a-z0-9_]{3,30}$/;

/**
 * Names nobody may claim.
 *
 * Application routes, the obvious impersonation risks, and the words a support
 * or system account would want. Reserving them is cheap now and impossible
 * later.
 */
const RESERVED = new Set([
  "about", "account", "admin", "api", "auth", "c", "collection", "collections",
  "contact", "explore", "feed", "help", "home", "invite", "legal", "login",
  "logout", "me", "n", "new", "note", "notes", "privacy", "profile", "root",
  "search", "security", "settings", "signin", "signup", "sign_in", "sign_up",
  "staff", "support", "system", "tag", "tags", "terms", "trackjot", "user",
  "users", "www",
]);

export type UsernameProblem = "shape" | "reserved" | "taken";

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Format and reserved-word checks. Does not touch the database. */
export function checkUsernameShape(raw: string): UsernameProblem | null {
  const name = normalizeUsername(raw);
  if (!SHAPE.test(name)) return "shape";
  if (RESERVED.has(name)) return "reserved";
  return null;
}

export function describeProblem(problem: UsernameProblem): string {
  switch (problem) {
    case "shape":
      return "Usernames are 3–30 characters, using letters, numbers and underscores.";
    case "reserved":
      return "That one is reserved. Try another.";
    case "taken":
      return "Someone already has that one.";
  }
}

/**
 * Claim a username for a user.
 *
 * The uniqueness check and the write are one statement rather than a read
 * followed by a write: two people typing the same handle at the same instant is
 * exactly the case a check-then-set gets wrong, so the unique index settles it
 * and the conflict is caught here.
 */
export async function setUsername(
  userId: string,
  raw: string,
): Promise<{ ok: true; username: string } | { ok: false; problem: UsernameProblem }> {
  const problem = checkUsernameShape(raw);
  if (problem) return { ok: false, problem };

  const username = normalizeUsername(raw);
  try {
    await prisma.user.update({ where: { id: userId }, data: { username } });
    return { ok: true, username };
  } catch {
    // The only unique constraint on this update is the username itself.
    return { ok: false, problem: "taken" };
  }
}

export async function isUsernameAvailable(raw: string): Promise<boolean> {
  if (checkUsernameShape(raw)) return false;
  const existing = await prisma.user.findUnique({
    where: { username: normalizeUsername(raw) },
    select: { id: true },
  });
  return !existing;
}
