"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { LastfmUnavailableError } from "@/lib/music/lastfm/client";
import { Provider } from "@prisma/client";
import type { TrackCandidate } from "@/lib/music/match-track";
import {
  LastfmNotLinkedError,
  candidatesForListen,
  dismissLastfmPrompt,
  importListen,
  invalidateLastfmSession,
  syncRecentListens,
  unlinkLastfm,
  type ListenView,
} from "@/lib/listens/service";

/**
 * Server Actions for the listening-history source.
 *
 * Every one derives the acting user from the verified session and passes that
 * id as the owner. Nothing here reads a user id from form data — the rule the
 * whole authorization model rests on.
 */

export async function unlinkLastfmAction(): Promise<void> {
  const user = await requireUser();
  await unlinkLastfm(user.id);
  revalidatePath("/notes");
  revalidatePath("/account");
}

export async function dismissLastfmPromptAction(): Promise<void> {
  const user = await requireUser();
  await dismissLastfmPrompt(user.id);
  revalidatePath("/notes");
}

export type RecentState =
  | { ok: true; listens: ListenView[] }
  | { ok: false; message: string };

/**
 * Read the recent feed for the strip on the notes page.
 *
 * Called from the client after the page has rendered, deliberately: the notes
 * page must never wait on Last.fm to paint. If this is slow or fails, the
 * strip says so and everything else on the page is already there.
 */
export async function recentListensAction(): Promise<RecentState> {
  const user = await requireUser();

  try {
    return { ok: true, listens: await syncRecentListens(user.id, 10) };
  } catch (error) {
    if (error instanceof LastfmNotLinkedError) {
      return { ok: false, message: "No Last.fm account is connected." };
    }
    if (error instanceof LastfmUnavailableError) {
      /**
       * A rejected session key is cleared rather than retried. Keeping it would
       * make every later read fail identically with nothing the user could act
       * on; clearing it puts the connection into the one state the UI can
       * explain, which is "reconnect".
       */
      if (error.reason === "bad-session") {
        /**
         * The key is dropped and the read retried **once, publicly**. A revoked
         * key makes even a public profile fail while it is still stored, so
         * without the retry the user would see an error on this visit and
         * silently working plays on the next — which reads as a glitch. The
         * retry turns the common case into a seamless degrade, and leaves a
         * genuine "reconnect" message only for the profiles that need one.
         */
        await invalidateLastfmSession(user.id);
        try {
          return { ok: true, listens: await syncRecentListens(user.id, 10) };
        } catch {
          return {
            ok: false,
            message: "Your Last.fm connection was revoked. Reconnect it from your account.",
          };
        }
      }
      if (error.reason === "login-required") {
        return {
          ok: false,
          message:
            "Last.fm is hiding this profile's listening. Reconnect from your account to read it.",
        };
      }
      if (error.reason === "no-such-user") {
        return { ok: false, message: "Last.fm no longer has that profile." };
      }
      return { ok: false, message: "Last.fm isn't answering right now. Your notes are unaffected." };
    }
    throw error;
  }
}

/**
 * Suggest provider matches for a play the user is about to write about.
 *
 * Deliberately its own round trip, fired when they open the editor rather than
 * when the strip renders — see `candidatesForListen`.
 */
export async function candidatesAction(input: {
  trackName: string;
  artistName: string;
}): Promise<TrackCandidate[]> {
  const user = await requireUser();
  try {
    return await candidatesForListen(user.id, input);
  } catch {
    // No suggestions is a fine outcome. A note must never be blocked on one.
    return [];
  }
}

export interface ImportState {
  error?: string;
  savedTrack?: string;
}

/**
 * Capture a play as a private jot.
 *
 * The whole track is accepted alongside its ref because a *now playing* track
 * has no stored row yet — it is not a play Last.fm has reported. The values are
 * only ever used to create that row; the recording is resolved from the
 * identifier, never from what the form said, so a tampered field can at worst
 * describe a different real song in the user's own private library.
 */
export async function importListenAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await requireUser();

  const sourceRef = String(formData.get("sourceRef") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!sourceRef) return { error: "Something went wrong reading that play." };
  if (!body) return { error: "Write something about it first." };

  const trackName = String(formData.get("trackName") ?? "").trim();
  const artistName = String(formData.get("artistName") ?? "").trim();

  /**
   * The match the user confirmed, if any. Only the provider and id are read —
   * both validated here — because everything else about the track is re-read
   * from the provider itself. A tampered form can at worst name a different
   * real track in the user's own private library.
   */
  const confirmedProvider = String(formData.get("confirmedProvider") ?? "");
  const confirmedId = String(formData.get("confirmedId") ?? "").trim();
  const confirmed =
    confirmedId && Object.values(Provider).includes(confirmedProvider as Provider)
      ? { provider: confirmedProvider as Provider, providerId: confirmedId }
      : null;

  try {
    await importListen(user.id, {
      sourceRef,
      body,
      confirmed,
      track:
        trackName && artistName
          ? {
              trackName,
              artistName,
              albumName: String(formData.get("albumName") ?? "").trim() || null,
              playedAt: null,
              recordingMbid: String(formData.get("recordingMbid") ?? "").trim() || null,
              artistMbid: null,
              albumMbid: null,
              url: String(formData.get("url") ?? "").trim() || null,
              sourceRef,
            }
          : undefined,
    });
  } catch (error) {
    if (error instanceof LastfmNotLinkedError) {
      return { error: "That play is no longer available. Refresh and try again." };
    }
    throw error;
  }

  revalidatePath("/notes");
  return { savedTrack: trackName || "that track" };
}
