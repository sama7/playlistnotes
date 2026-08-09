import { Prisma, Provider, RecordingOrigin, type Recording } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizedKey } from "@/lib/music/normalize";

/**
 * Resolving a captured track to a Playlistnotes recording.
 *
 * The governing rule (AGENTS.md §7): **a false merge is worse than a duplicate.**
 * A duplicate is invisible while notes are private and fixable later with
 * `merged_into_id`; a false merge silently attaches one person's writing to the
 * wrong song and cannot be safely undone.
 *
 * So resolution matches on identifiers, never on similarity. Strings are
 * evidence, never identity.
 */

export type ResolutionStrategy = "provider-id" | "created" | "created-user-authored";

export interface ResolutionResult {
  recording: Recording;
  /** How we got here, recorded so decisions can be audited after the fact. */
  strategy: ResolutionStrategy;
  decision: "matched" | "created";
}

/**
 * Follow `merged_into_id` to the surviving recording.
 *
 * Resolution must never hand back a tombstone. The loop is bounded because a
 * cycle — however it got there — must not hang a request.
 */
async function followMerges(recording: Recording): Promise<Recording> {
  let current = recording;
  for (let hops = 0; hops < 8 && current.mergedIntoId; hops++) {
    const next = await prisma.recording.findUnique({ where: { id: current.mergedIntoId } });
    if (!next) break;
    current = next;
  }
  return current;
}

export interface CaptureInput {
  provider: Provider;
  providerId: string;
  providerUrl?: string;
  /** Best-effort provider metadata. Absent when oEmbed failed — by design. */
  title?: string | null;
  artistDisplay?: string | null;
  durationMs?: number | null;
  isrc?: string | null;
}

/**
 * Resolve a provider-anchored capture, creating the recording on first sight.
 *
 * Step 1 of §7 and, for the track-link path, the only step: an exact
 * `(provider, provider_id)` match. Everyone's Spotify URI for a given track is
 * byte-identical, so this alone deduplicates the overwhelming majority — no
 * fuzzy matching required, and none attempted.
 */
export async function resolveByProviderId(input: CaptureInput): Promise<ResolutionResult> {
  const existing = await prisma.recordingExternalId.findUnique({
    where: { provider_providerId: { provider: input.provider, providerId: input.providerId } },
    include: { recording: true },
  });

  if (existing) {
    return {
      recording: await followMerges(existing.recording),
      strategy: "provider-id",
      decision: "matched",
    };
  }

  const title = (input.title ?? "").trim() || "Untitled";
  const artistDisplay = (input.artistDisplay ?? "").trim() || "Unknown artist";

  try {
    const recording = await prisma.recording.create({
      data: {
        title,
        artistDisplay,
        origin: RecordingOrigin.provider,
        durationMs: input.durationMs ?? null,
        normalizedKey: normalizedKey({ title, artistDisplay, durationMs: input.durationMs }),
        externalIds: {
          create: {
            provider: input.provider,
            providerId: input.providerId,
            providerUrl: input.providerUrl,
            isrc: input.isrc ?? null,
          },
        },
      },
    });
    return { recording, strategy: "created", decision: "created" };
  } catch (error) {
    // Two people can capture the same track at the same instant. The unique
    // index on (provider, provider_id) settles it; the loser re-reads rather
    // than creating a duplicate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.recordingExternalId.findUniqueOrThrow({
        where: { provider_providerId: { provider: input.provider, providerId: input.providerId } },
        include: { recording: true },
      });
      return {
        recording: await followMerges(winner.recording),
        strategy: "provider-id",
        decision: "matched",
      };
    }
    throw error;
  }
}

/**
 * Create a recording from metadata a user typed, with no provider identifier.
 *
 * Always creates; never matches. Two users typing the same obscure song get two
 * rows, and that is correct — see AGENTS.md §3a.5. These stay scoped to their
 * creator and out of everyone else's resolution candidates, which is what lets
 * entry stay lax without the shared catalog filling with guesses.
 */
export async function createUserAuthoredRecording(input: {
  ownerId: string;
  title: string;
  artistDisplay: string;
  durationMs?: number | null;
}): Promise<ResolutionResult> {
  const title = input.title.trim();
  const artistDisplay = input.artistDisplay.trim();

  const recording = await prisma.recording.create({
    data: {
      title,
      artistDisplay,
      origin: RecordingOrigin.user,
      createdById: input.ownerId,
      durationMs: input.durationMs ?? null,
      normalizedKey: normalizedKey({ title, artistDisplay, durationMs: input.durationMs }),
    },
  });

  return { recording, strategy: "created-user-authored", decision: "created" };
}
