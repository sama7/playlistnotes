import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
  // Deliberate shares. These read only what visibility permits.
  "/n/(.*)", // unlisted or public notes, addressed by share token
  "/c/(.*)", // unlisted or public collections
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
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
