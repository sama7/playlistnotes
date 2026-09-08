import { DatePrecision, ListenSource, Provider, type Listen } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizedKey } from "@/lib/music/normalize";
import {
  LastfmUnavailableError,
  fetchRecentTracks,
  lastfmUserExists,
  type RecentTrack,
} from "@/lib/music/lastfm/client";
import { createUserAuthoredRecording, resolveByProviderId } from "@/lib/music/resolve-recording";
import { createNote } from "@/lib/notes/service";

/**
 * Listening history as a source, and the one judgement call it forces.
 *
 * ## What a scrobble is allowed to create
 *
 * The catalog rule is that **entities come from identifiers, never from names**
 * (AGENTS.md §3a), and Last.fm is explicitly not permitted to establish
 * recording identity. A scrobble arrives as three strings and, sometimes, a
 * MusicBrainz id. So it forks:
 *
 *   - **With a recording MBID** — MusicBrainz is a trusted `Provider`, so the
 *     play resolves through the ordinary `resolveByProviderId` path. It matches
 *     an existing recording if we already hold that id and creates a
 *     provider-anchored one otherwise, exactly as a pasted link would.
 *   - **Without one** — a `origin = user` recording, scoped to its creator and
 *     kept out of everyone else's resolution candidates. Two people scrobbling
 *     the same obscure song get two rows, and that is correct: a duplicate is
 *     cheap, a false merge is not.
 *
 * **The MBID is where the risk lives, and it is worth naming.** The id itself
 * comes from an authority; the claim that *this play* is *that recording* comes
 * from Last.fm's own matching, which is not perfect. That claim is therefore
 * also written to the listen row as provenance — so if Last.fm is ever found to
 * have mis-matched, every recording it influenced can be located and unwound.
 * The alternative, resolving by name, is the one thing the contract forbids
 * outright.
 *
 * ## What it never creates
 *
 * No artist rows, no album rows. Last.fm supplies those as names, and a name is
 * not an identifier. The album title is carried as `releaseTitle` — display
 * data, which is exactly what the schema says that column is for.
 */

/** A play, prepared for rendering. Flat, so the UI does no joining. */
export interface ListenView {
  sourceRef: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
  playedAt: Date | null;
  url: string | null;
  /** True when Last.fm gave a MusicBrainz id, so the import can be anchored. */
  identified: boolean;
  /** Set once imported, so the strip can say so instead of offering it twice. */
  importedNoteId: string | null;
}

const NOW_PLAYING_PREFIX = "nowplaying:";
/** How long a now-playing capture stays eligible to absorb its completed play. */
const RECONCILE_WINDOW_MS = 30 * 60 * 1000;

export class LastfmNotLinkedError extends Error {
  constructor() {
    super("No Last.fm account is linked.");
    this.name = "LastfmNotLinkedError";
  }
}

/**
 * Store a Last.fm username after checking the profile exists.
 *
 * The check catches a typo at the moment it is made, which is the whole of its
 * job. It deliberately does **not** establish that the person typing owns the
 * profile: the contract permits claiming verification only if the product says
 * the profile is verified, and it says no such thing. This is a feed to read.
 */
export async function linkLastfm(
  userId: string,
  rawUsername: string,
): Promise<{ ok: true; username: string } | { ok: false; message: string }> {
  // Last.fm names are case-insensitive but display with case; store as typed,
  // trimmed. A URL pasted instead of a name is a common slip worth absorbing.
  const username = rawUsername
    .trim()
    .replace(/^https?:\/\/(www\.)?last\.fm\/user\//i, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!username) return { ok: false, message: "Enter your Last.fm username." };
  if (!/^[A-Za-z0-9_.-]{2,64}$/.test(username)) {
    return { ok: false, message: "That doesn't look like a Last.fm username." };
  }

  try {
    if (!(await lastfmUserExists(username))) {
      return { ok: false, message: `Last.fm has no user called “${username}”.` };
    }
  } catch (error) {
    if (error instanceof LastfmUnavailableError) {
      return {
        ok: false,
        message:
          error.reason === "not-configured"
            ? "Last.fm isn't set up on this server yet."
            : "We couldn't reach Last.fm to check that name. Try again in a moment.",
      };
    }
    throw error;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { lastfmUsername: username, lastfmLinkedAt: new Date() },
  });
  return { ok: true, username };
}

/**
 * Forget the username.
 *
 * Listens already recorded are **kept**, and so are the notes written from
 * them. Disconnecting a source is not a request to delete your own history —
 * the writing is yours, and it stopped being Last.fm's the moment you wrote it.
 */
export async function unlinkLastfm(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastfmUsername: null, lastfmLinkedAt: null },
  });
}

export async function dismissLastfmPrompt(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastfmPromptDismissedAt: new Date() },
  });
}

/** Normalized (artist, track), for spotting the same song reported twice. */
function playKey(artistName: string, trackName: string): string {
  return normalizedKey({ title: trackName, artistDisplay: artistName, durationMs: null });
}

/**
 * Read the recent feed and fold it into the listens ledger.
 *
 * Idempotent by `(owner, source, sourceRef)`: re-reading the same window
 * updates rather than duplicating a person's history. A now-playing track is
 * **not** persisted here — it is not yet a play Last.fm has reported — but it is
 * returned so the strip can offer the freshest moment of all.
 */
export async function syncRecentListens(
  userId: string,
  limit = 10,
): Promise<ListenView[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { lastfmUsername: true },
  });
  if (!user.lastfmUsername) throw new LastfmNotLinkedError();

  const tracks = await fetchRecentTracks(user.lastfmUsername, limit);

  for (const track of tracks) {
    if (!track.playedAt) continue;
    await persistPlay(userId, track);
  }

  return viewFor(userId, tracks);
}

/**
 * Write one completed play, absorbing an earlier now-playing capture of it.
 *
 * Without the absorption step, jotting a song *while it played* and then having
 * Last.fm report the finished play would leave two rows for one listen — the
 * imported one and an orphan. Matching on normalized (artist, track) within a
 * short window collapses them, which keeps "how many times have I heard this"
 * answerable.
 */
async function persistPlay(userId: string, track: RecentTrack): Promise<void> {
  const playedAt = track.playedAt!;

  const pending = await prisma.listen.findFirst({
    where: {
      ownerId: userId,
      source: ListenSource.lastfm,
      sourceRef: { startsWith: NOW_PLAYING_PREFIX },
      playedAt: { gte: new Date(playedAt.getTime() - RECONCILE_WINDOW_MS) },
    },
    orderBy: { playedAt: "desc" },
  });

  if (pending && playKey(pending.artistName, pending.trackName) === playKey(track.artistName, track.trackName)) {
    await prisma.listen.update({
      where: { id: pending.id },
      data: { sourceRef: track.sourceRef, playedAt, sourceUrl: track.url },
    });
    return;
  }

  await prisma.listen.upsert({
    where: {
      ownerId_source_sourceRef: {
        ownerId: userId,
        source: ListenSource.lastfm,
        sourceRef: track.sourceRef,
      },
    },
    create: {
      ownerId: userId,
      source: ListenSource.lastfm,
      sourceRef: track.sourceRef,
      sourceUrl: track.url,
      playedAt,
      trackName: track.trackName,
      artistName: track.artistName,
      albumName: track.albumName,
      recordingMbid: track.recordingMbid,
      artistMbid: track.artistMbid,
      albumMbid: track.albumMbid,
    },
    // A re-read may carry mbids a first read lacked; nothing else changes.
    update: {
      recordingMbid: track.recordingMbid,
      artistMbid: track.artistMbid,
      albumMbid: track.albumMbid,
      sourceUrl: track.url,
    },
  });
}

/** Merge the live feed with what we know about it, newest first. */
async function viewFor(userId: string, tracks: RecentTrack[]): Promise<ListenView[]> {
  const stored = await prisma.listen.findMany({
    where: {
      ownerId: userId,
      source: ListenSource.lastfm,
      sourceRef: { in: tracks.map((t) => t.sourceRef) },
    },
    select: { sourceRef: true, recordingId: true },
  });

  /**
   * Only the ids that exist. An empty-string placeholder for "no recording"
   * reaches the driver as an invalid uuid and fails the whole query — the
   * column is typed, so a sentinel has to be an absent clause rather than a
   * fake value.
   */
  const recordingIds = stored
    .map((s) => s.recordingId)
    .filter((id): id is string => id !== null);

  const importedNotes =
    recordingIds.length > 0
      ? await prisma.note.findMany({
          where: { ownerId: userId, recordingId: { in: recordingIds } },
          select: { id: true, recordingId: true },
        })
      : [];
  const noteByRecording = new Map(importedNotes.map((n) => [n.recordingId, n.id]));
  const recordingByRef = new Map(stored.map((s) => [s.sourceRef, s.recordingId]));

  return tracks.map((track) => {
    const recordingId = recordingByRef.get(track.sourceRef) ?? null;
    return {
      sourceRef: track.sourceRef,
      trackName: track.trackName,
      artistName: track.artistName,
      albumName: track.albumName,
      playedAt: track.playedAt,
      url: track.url,
      identified: Boolean(track.recordingMbid),
      importedNoteId: recordingId ? (noteByRecording.get(recordingId) ?? null) : null,
    };
  });
}

/**
 * Turn one play into a recording and a private jot about it.
 *
 * The listening instant becomes the note's `experiencedAt` at `time`
 * precision — the reason the whole integration exists. A note written today
 * about a song heard on Tuesday is dated Tuesday.
 */
export async function importListen(
  userId: string,
  input: { sourceRef: string; body: string; track?: RecentTrack },
): Promise<{ noteId: string }> {
  let listen = await prisma.listen.findUnique({
    where: {
      ownerId_source_sourceRef: {
        ownerId: userId,
        source: ListenSource.lastfm,
        sourceRef: input.sourceRef,
      },
    },
  });

  /**
   * A now-playing track has no persisted row, because it is not yet a play
   * Last.fm has reported. Capturing it writes one at this instant, which is
   * true: you are hearing it now. `persistPlay` later folds the completed
   * scrobble into this row rather than leaving an orphan beside it.
   */
  if (!listen && input.track && input.sourceRef.startsWith(NOW_PLAYING_PREFIX)) {
    listen = await prisma.listen.create({
      data: {
        ownerId: userId,
        source: ListenSource.lastfm,
        sourceRef: input.sourceRef,
        sourceUrl: input.track.url,
        playedAt: new Date(),
        trackName: input.track.trackName,
        artistName: input.track.artistName,
        albumName: input.track.albumName,
        recordingMbid: input.track.recordingMbid,
        artistMbid: input.track.artistMbid,
        albumMbid: input.track.albumMbid,
      },
    });
  }

  if (!listen) throw new LastfmNotLinkedError();

  const recordingId = listen.recordingId ?? (await resolveRecordingFor(userId, listen)).id;

  const note = await createNote(userId, {
    recordingId,
    body: input.body,
    experiencedAt: listen.playedAt,
    experiencedPrecision: DatePrecision.time,
  });

  await prisma.listen.update({
    where: { id: listen.id },
    data: { recordingId, importedAt: new Date() },
  });

  return { noteId: note.id };
}

/** The fork described at the top of this file: identifier, or creator-scoped. */
async function resolveRecordingFor(userId: string, listen: Listen) {
  if (listen.recordingMbid) {
    const resolved = await resolveByProviderId({
      provider: Provider.musicbrainz,
      providerId: listen.recordingMbid,
      title: listen.trackName,
      artistDisplay: listen.artistName,
    });
    // The album name is display data, never an entity — see the header.
    if (listen.albumName && !resolved.recording.releaseTitle) {
      await prisma.recording.update({
        where: { id: resolved.recording.id },
        data: { releaseTitle: listen.albumName },
      });
    }
    return resolved.recording;
  }

  const { recording } = await createUserAuthoredRecording({
    ownerId: userId,
    title: listen.trackName,
    artistDisplay: listen.artistName,
  });

  if (listen.albumName) {
    await prisma.recording.update({
      where: { id: recording.id },
      data: { releaseTitle: listen.albumName },
    });
  }
  return recording;
}
