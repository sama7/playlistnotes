import { timingSafeEqual } from "node:crypto";

/**
 * The invite gate for the pre-launch host.
 *
 * The docs claimed this existed for weeks and it did not: `REQUIRE_INVITE_CODE`
 * and `INVITE_CODE` were declared in `.env.example` and read by nothing.
 * `noindex` keeps a host out of search results; it is not access control, and
 * anyone with the URL could sign up.
 *
 * ## What this is and is not
 *
 * It is a **doormat, not a lock.** A shared code held by ten testers is not a
 * secret, and it is not defending anything valuable — every note is already
 * owner-scoped in the query, so a stranger who got past this would still see
 * nothing of anyone else's. Its job is to stop a passer-by, a crawler that
 * ignores `noindex`, or a link forwarded further than intended from creating
 * accounts while the product is unfinished.
 *
 * Saying that plainly matters, because the failure mode of a gate like this is
 * believing it is stronger than it is and then relying on it.
 *
 * ## Why the cookie is not the code
 *
 * Passing the gate sets a cookie holding a **derived** value, never the code
 * itself. If the code later needs rotating, a stale cookie stops working; and
 * anyone reading the cookie jar on a shared machine learns nothing they could
 * pass to someone else.
 */

export const INVITE_COOKIE = "tj_invite";
export const INVITE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Whether the gate is switched on AND actually usable. */
export function inviteGateEnabled(): boolean {
  return process.env.REQUIRE_INVITE_CODE === "true" && Boolean(process.env.INVITE_CODE?.trim());
}

/**
 * True when the gate is on but no code is set — a configuration mistake that
 * would otherwise silently disable it.
 *
 * Reported rather than thrown: refusing to boot would take the whole site down
 * over a gate that is deliberately not a security boundary. Failing open and
 * saying so loudly is the better trade here, and the deploy check catches it.
 */
export function inviteGateMisconfigured(): boolean {
  return process.env.REQUIRE_INVITE_CODE === "true" && !process.env.INVITE_CODE?.trim();
}

/** Constant-time compare, so the endpoint cannot be used as an oracle. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) {
    // Compare against itself to keep the work roughly constant, then fail.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function isValidInviteCode(supplied: string): boolean {
  const expected = process.env.INVITE_CODE?.trim() ?? "";
  if (!expected) return false;
  return safeEqual(supplied.trim(), expected);
}

/**
 * The value stored in the cookie: a keyed digest of the code.
 *
 * Uses the Clerk secret as the key purely because it is a server-only secret
 * that already exists — this is a gate, not a credential system, and adding
 * another secret to manage would be a worse trade than reusing one.
 */
export async function inviteCookieValue(): Promise<string> {
  const code = process.env.INVITE_CODE?.trim() ?? "";
  const key = process.env.CLERK_SECRET_KEY ?? "trackjot-invite";
  const data = new TextEncoder().encode(`${key}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("base64url").slice(0, 32);
}

export async function hasValidInviteCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  return safeEqual(value, await inviteCookieValue());
}
