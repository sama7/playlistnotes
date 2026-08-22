import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { INVITE_COOKIE, hasValidInviteCookie, inviteGateEnabled } from "@/lib/invite";
import {
  BREADCRUMB_MAX_AGE_SECONDS,
  LAST_SEEN_COOKIE,
  VISITOR_COOKIE,
  epochDay,
} from "@/lib/session-lapse";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`. The file must
 * export the handler as a default export or as a named `proxy` export. Clerk's
 * documentation still says `middleware.ts`, which is the Next 15 name.
 *
 * This runs before routes render, so it is the outermost gate. It is NOT the
 * authorization boundary: every owner-scoped query re-derives the acting user
 * from the verified session server-side (see lib/auth.ts). A route guard that
 * the UI trusts is not a substitute for scoping the query.
 */

/** Routes anyone may reach without signing in. */
const isPublicRoute = createRouteMatcher([
  "/",
  "/about",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
  // The invite gate itself. Without this the two guards fight: the gate sends an
  // uninvited visitor here, and auth.protect() sends them back to sign-in,
  // which the gate bounces to /invite — a redirect loop that locks everyone out.
  "/invite",
  /**
   * Machine-readable surfaces. A crawler has no session and an unfurling chat
   * client has no cookies, so protecting these does not hide anything — it just
   * serves them a sign-in redirect instead of the file. `/opengraph-image` has
   * no extension, and `.txt`/`.xml` are not in the static-file exclusion below,
   * so all three reached the auth guard and 307'd.
   */
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  // Deliberate shares. These read only what visibility permits.
  "/n/(.*)", // unlisted or public notes, addressed by share token
  "/c/(.*)", // unlisted or public collections
]);

/**
 * Routes that stay reachable even when the invite gate is closed.
 *
 * Share links are the important entry: someone who was sent a public note has
 * no invite code and should not need one. The gate exists to stop *account
 * creation* by passers-by, not to hide content its owner deliberately
 * published. Health stays open so monitoring does not need a cookie.
 */
const bypassesInviteGate = createRouteMatcher([
  "/invite",
  "/api/health",
  "/n/(.*)",
  "/c/(.*)",
  // Same reasoning as above: these have no user to invite. The gate stops
  // account creation, and a robots file has never created an account.
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  "/manifest.webmanifest",
]);

export default clerkMiddleware(async (auth, request) => {
  /**
   * The gate runs BEFORE authentication, so an uninvited visitor never reaches
   * the sign-up form at all. Checking it after would let anyone create an
   * account and only then be told the site is private.
   *
   * An already-signed-in user is let through: they were invited once, and
   * revoking the code should not lock out people already using the product.
   */
  if (inviteGateEnabled() && !bypassesInviteGate(request)) {
    const { userId } = await auth();
    const cookie = request.cookies.get(INVITE_COOKIE)?.value;

    if (!userId && !(await hasValidInviteCookie(cookie))) {
      const invite = new URL("/invite", request.url);
      invite.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(invite);
    }
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  const { userId } = await auth();
  if (!userId) return;

  // Signed in: refresh the breadcrumb that will outlive this session. Only the
  // proxy can write cookies here — Server Components cannot — which is why the
  // instrumentation lives at this layer rather than beside the query it feeds.
  const today = String(epochDay());
  const hasVisitor = request.cookies.has(VISITOR_COOKIE);
  const lastSeenIsCurrent = request.cookies.get(LAST_SEEN_COOKIE)?.value === today;
  if (hasVisitor && lastSeenIsCurrent) return;

  const response = NextResponse.next();
  const options = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: BREADCRUMB_MAX_AGE_SECONDS,
  } as const;

  if (!hasVisitor) {
    response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), options);
  }
  if (!lastSeenIsCurrent) {
    response.cookies.set(LAST_SEEN_COOKIE, today, options);
  }
  return response;
});

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless a search param
    // is present (so that route handlers still run).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
