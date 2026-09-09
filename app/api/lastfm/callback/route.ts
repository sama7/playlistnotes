import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { LastfmUnavailableError, exchangeToken } from "@/lib/music/lastfm/client";
import { prisma } from "@/lib/db";
import { LASTFM_STATE_COOKIE, appOrigin } from "@/lib/listens/oauth";

export const dynamic = "force-dynamic";

/** Send the user back to their account page with something to read. */
function back(outcome: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/account?lastfm=${outcome}`, appOrigin()));
  // The state is single-use whatever the outcome; leaving it set would let a
  // replayed callback pass the check a second time.
  response.cookies.delete(LASTFM_STATE_COOKIE);
  return response;
}

/**
 * Finish connecting a Last.fm account.
 *
 * Last.fm sends the user back here with a one-time token once they have
 * approved on their own site. Exchanging it is signed with the shared secret,
 * which is what makes the approval provable rather than merely claimed.
 *
 * The account name comes from Last.fm's own reply, never from the URL — so a
 * tampered callback cannot make TrackJot record a profile the user did not
 * actually approve.
 */
export async function GET(request: Request) {
  const user = await requireUser();

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const state = url.searchParams.get("state");

  const expected = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LASTFM_STATE_COOKIE}=`))
    ?.split("=")[1];

  // Both halves must be present and equal. A missing cookie is as much a
  // failure as a mismatched one — it is what a cross-site attempt looks like.
  if (!state || !expected || state !== expected) return back("state");
  if (!token) return back("denied");

  let session;
  try {
    session = await exchangeToken(token);
  } catch (error) {
    if (error instanceof LastfmUnavailableError) return back("failed");
    throw error;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastfmUsername: session.username,
      lastfmSessionKey: session.sessionKey,
      lastfmLinkedAt: new Date(),
      // Connecting answers the prompt, so it should stop being offered.
      lastfmPromptDismissedAt: new Date(),
    },
  });

  return back("connected");
}
