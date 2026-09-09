import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { lastfmAuthConfigured, lastfmAuthUrl } from "@/lib/music/lastfm/client";
import { LASTFM_STATE_COOKIE, lastfmCallbackUrl } from "@/lib/listens/oauth";

export const dynamic = "force-dynamic";

/**
 * Begin connecting a Last.fm account.
 *
 * A route handler rather than a Server Action because the outcome is a
 * *navigation* to someone else's site, and the browser has to make it itself.
 *
 * The random `state` is written to an httpOnly cookie and checked on the way
 * back. Without it, an attacker could hand a signed-in user a crafted callback
 * URL carrying the attacker's own approval token and silently attach the
 * attacker's Last.fm account to that user's TrackJot — a login-CSRF. The user
 * would then be reading a stranger's listening history and believing it was
 * theirs.
 */
export async function GET() {
  await requireUser();

  if (!lastfmAuthConfigured()) {
    return NextResponse.redirect(new URL("/account?lastfm=unconfigured", lastfmCallbackUrl()));
  }

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(lastfmAuthUrl(lastfmCallbackUrl(state)));

  response.cookies.set(LASTFM_STATE_COOKIE, state, {
    httpOnly: true,
    // `lax` rather than `strict`: the cookie has to survive Last.fm's top-level
    // redirect back to us, which `strict` would withhold — and then every
    // connection attempt would fail its own CSRF check.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return response;
}
