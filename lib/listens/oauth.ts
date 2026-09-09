/**
 * Where Last.fm sends people back to, and the cookie that proves it was us who
 * sent them.
 *
 * Shared so the origin is derived in one place. Note that `auth.getSession`
 * signs only the api key, method and token — the callback is not part of the
 * exchange, so it need not be reproduced there.
 */

export const LASTFM_STATE_COOKIE = "tj_lastfm_state";

/**
 * The public origin of this deployment.
 *
 * From `APP_BASE_URL` at runtime, never baked in — the same artifact serves
 * localhost and production, and a hostname compiled into a redirect would send
 * production users to a developer's laptop.
 */
export function appOrigin(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3100";
}

export function lastfmCallbackUrl(state?: string): string {
  const url = new URL("/api/lastfm/callback", appOrigin());
  // Last.fm appends `?token=…` to whatever callback it is given, so the state
  // is carried as an existing query parameter. Their handling of a callback
  // that already has a query string is the reason this is built with `URL`
  // rather than string concatenation.
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
