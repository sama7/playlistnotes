import { randomBytes } from "node:crypto";
import { Visibility, type Note } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Note operations.
 *
 * Every function here takes `ownerId` as its FIRST argument, and that value
 * comes only from `requireUser()` — never from a request body, a query string,
 * or a form field. This is the exact defect that made v1's endpoints
 * world-writable: `routes/note.js` read `user` from the query string.
 *
 * The second rule: **owner-scoped queries, not fetch-then-check.** Reading a
 * row and then comparing its owner leaves a window and invites a missing
 * branch. Instead the owner is part of the `where` clause, so a mismatched
 * request finds nothing — and "not found" is also the right thing to tell a
 * stranger, since confirming a note exists is itself a disclosure.
 */

export const noteBodySchema = z
  .string()
  .trim()
  .min(1, "A note needs something in it.")
  .max(10_000, "Notes are limited to 10,000 characters.");

export const createNoteSchema = z.object({
  recordingId: z.string().uuid(),
  body: noteBodySchema,
  collectionItemId: z.string().uuid().nullish(),
  displayTitle: z.string().trim().max(500).nullish(),
  displayArtist: z.string().trim().max(500).nullish(),
});

export const updateNoteSchema = z.object({
  body: noteBodySchema.optional(),
  displayTitle: z.string().trim().max(500).nullish(),
  displayArtist: z.string().trim().max(500).nullish(),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/** Raised when a resource is absent *or* belongs to someone else. Callers must
 *  not distinguish the two: the difference is exactly what an attacker wants. */
export class NoteNotFoundError extends Error {
  constructor() {
    super("Note not found.");
    this.name = "NoteNotFoundError";
  }
}

export class InvalidCollectionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCollectionContextError";
  }
}

/** 24 bytes of base64url — unguessable, and rotatable without touching the note. */
function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Validate optional playlist context.
 *
 * A note may point at a collection item to preserve "this track, in this
 * playlist". Two things must hold, and both are checked here rather than
 * trusted: the item must belong to the note's owner, and it must point at the
 * same recording. Otherwise a user could attach their note to a stranger's
 * collection, or to a different song entirely.
 */
async function assertCollectionContext(
  ownerId: string,
  collectionItemId: string,
  recordingId: string,
): Promise<void> {
  const item = await prisma.collectionItem.findFirst({
    where: { id: collectionItemId, collection: { ownerId } },
    select: { recordingId: true },
  });

  if (!item) {
    throw new InvalidCollectionContextError("That collection item is not available.");
  }
  if (item.recordingId !== recordingId) {
    throw new InvalidCollectionContextError(
      "That collection item refers to a different recording.",
    );
  }
}

export async function createNote(ownerId: string, input: CreateNoteInput): Promise<Note> {
  const data = createNoteSchema.parse(input);

  if (data.collectionItemId) {
    await assertCollectionContext(ownerId, data.collectionItemId, data.recordingId);
  }

  return prisma.note.create({
    data: {
      ownerId,
      recordingId: data.recordingId,
      body: data.body,
      collectionItemId: data.collectionItemId ?? null,
      displayTitle: data.displayTitle ?? null,
      displayArtist: data.displayArtist ?? null,
      visibility: Visibility.private,
    },
  });
}

export async function listNotes(ownerId: string, limit = 50): Promise<Note[]> {
  return prisma.note.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(limit, 200),
  });
}

/** Owner-scoped read. A valid id belonging to someone else returns null. */
export async function getNote(ownerId: string, noteId: string): Promise<Note | null> {
  return prisma.note.findFirst({ where: { id: noteId, ownerId } });
}

export async function updateNote(
  ownerId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<Note> {
  const data = updateNoteSchema.parse(input);

  // updateMany scopes by owner in the WHERE clause, so a mismatch updates zero
  // rows rather than throwing something that could be mistaken for success.
  const result = await prisma.note.updateMany({
    where: { id: noteId, ownerId },
    data: {
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.displayTitle !== undefined ? { displayTitle: data.displayTitle } : {}),
      ...(data.displayArtist !== undefined ? { displayArtist: data.displayArtist } : {}),
    },
  });

  if (result.count === 0) throw new NoteNotFoundError();
  return prisma.note.findFirstOrThrow({ where: { id: noteId, ownerId } });
}

export async function deleteNote(ownerId: string, noteId: string): Promise<void> {
  const result = await prisma.note.deleteMany({ where: { id: noteId, ownerId } });
  if (result.count === 0) throw new NoteNotFoundError();
}

/**
 * Publish a note as unlisted, minting a share token on first use.
 *
 * The token is what the URL exposes, never the note's UUID — so a leaked link
 * can be revoked by rotating it without destroying the note.
 */
export async function publishNoteUnlisted(ownerId: string, noteId: string): Promise<Note> {
  const existing = await getNote(ownerId, noteId);
  if (!existing) throw new NoteNotFoundError();

  return prisma.note.update({
    where: { id: existing.id },
    data: {
      visibility: Visibility.unlisted,
      shareToken: existing.shareToken ?? newShareToken(),
      publishedAt: existing.publishedAt ?? new Date(),
    },
  });
}

export async function rotateShareToken(ownerId: string, noteId: string): Promise<Note> {
  const existing = await getNote(ownerId, noteId);
  if (!existing) throw new NoteNotFoundError();
  return prisma.note.update({
    where: { id: existing.id },
    data: { shareToken: newShareToken() },
  });
}

export async function unpublishNote(ownerId: string, noteId: string): Promise<Note> {
  const existing = await getNote(ownerId, noteId);
  if (!existing) throw new NoteNotFoundError();
  return prisma.note.update({
    where: { id: existing.id },
    data: { visibility: Visibility.private, shareToken: null, publishedAt: null },
  });
}

/**
 * Fetch a note by share token, for anonymous viewers.
 *
 * Requires the visibility to still permit it — un-publishing must actually
 * revoke access, not merely hide the link.
 */
export async function getSharedNote(shareToken: string): Promise<Note | null> {
  return prisma.note.findFirst({
    where: {
      shareToken,
      visibility: { in: [Visibility.unlisted, Visibility.public] },
    },
  });
}
