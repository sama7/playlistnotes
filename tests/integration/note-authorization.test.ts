import { PrismaClient, Provider, RecordingOrigin, Visibility } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  NoteNotFoundError,
  InvalidCollectionContextError,
  createNote,
  deleteNote,
  getNote,
  getSharedNote,
  listNotes,
  publishNoteUnlisted,
  rotateShareToken,
  unpublishNote,
  updateNote,
} from "@/lib/notes/service";
import { resolveByProviderId } from "@/lib/music/resolve-recording";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * The scenario every test here shares: two real users, one shared recording,
 * and a note belonging to Ada.
 *
 * Crucially, User B always supplies a **valid UUID that really exists** — the
 * note's actual id. Tests that pass a random or malformed UUID prove almost
 * nothing, because they would pass even against a completely unguarded query.
 */
async function scenario() {
  const ada = await prisma.user.create({
    data: { authSubject: `subj_ada_${crypto.randomUUID()}`, username: "ada" },
  });
  const blue = await prisma.user.create({
    data: { authSubject: `subj_blue_${crypto.randomUUID()}`, username: "blue" },
  });

  const { recording } = await resolveByProviderId({
    provider: Provider.spotify,
    providerId: `id_${crypto.randomUUID().slice(0, 18)}`,
    title: "CN TOWER",
    artistDisplay: "PARTYNEXTDOOR & Drake",
    durationMs: 241_890,
  });

  const adasNote = await createNote(ada.id, {
    recordingId: recording.id,
    body: "Ada's private note about the opening track.",
  });

  return { ada, blue, recording, adasNote };
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cross-user denial — User B supplies a VALID UUID owned by User A", () => {
  it("cannot read it", async () => {
    const { blue, adasNote } = await scenario();
    expect(await getNote(blue.id, adasNote.id)).toBeNull();
  });

  it("cannot update it, and the note is untouched", async () => {
    const { blue, adasNote } = await scenario();

    await expect(updateNote(blue.id, adasNote.id, { body: "vandalised" })).rejects.toThrow(
      NoteNotFoundError,
    );

    const after = await prisma.note.findUniqueOrThrow({ where: { id: adasNote.id } });
    expect(after.body).toBe("Ada's private note about the opening track.");
  });

  it("cannot delete it, and the note survives", async () => {
    const { blue, adasNote } = await scenario();

    await expect(deleteNote(blue.id, adasNote.id)).rejects.toThrow(NoteNotFoundError);
    expect(await prisma.note.count({ where: { id: adasNote.id } })).toBe(1);
  });

  it("cannot publish it", async () => {
    const { blue, adasNote } = await scenario();

    await expect(publishNoteUnlisted(blue.id, adasNote.id)).rejects.toThrow(NoteNotFoundError);
    const after = await prisma.note.findUniqueOrThrow({ where: { id: adasNote.id } });
    expect(after.visibility).toBe(Visibility.private);
    expect(after.shareToken).toBeNull();
  });

  it("cannot rotate its share token", async () => {
    const { ada, blue, adasNote } = await scenario();
    const published = await publishNoteUnlisted(ada.id, adasNote.id);

    await expect(rotateShareToken(blue.id, adasNote.id)).rejects.toThrow(NoteNotFoundError);
    const after = await prisma.note.findUniqueOrThrow({ where: { id: adasNote.id } });
    expect(after.shareToken).toBe(published.shareToken);
  });

  it("cannot unpublish it", async () => {
    const { ada, blue, adasNote } = await scenario();
    await publishNoteUnlisted(ada.id, adasNote.id);

    await expect(unpublishNote(blue.id, adasNote.id)).rejects.toThrow(NoteNotFoundError);
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: adasNote.id } })).visibility,
    ).toBe(Visibility.unlisted);
  });

  it("never sees it in their own listing", async () => {
    const { blue, adasNote } = await scenario();
    const notes = await listNotes(blue.id);
    expect(notes.map((n) => n.id)).not.toContain(adasNote.id);
    expect(notes).toHaveLength(0);
  });

  /** The failure must be indistinguishable from a note that never existed. */
  it("reports a stranger's note exactly like a nonexistent one", async () => {
    const { blue, adasNote } = await scenario();
    const nonexistent = crypto.randomUUID();

    const strangersError = await updateNote(blue.id, adasNote.id, { body: "x" }).catch((e) => e);
    const missingError = await updateNote(blue.id, nonexistent, { body: "x" }).catch((e) => e);

    expect(strangersError.name).toBe(missingError.name);
    expect(strangersError.message).toBe(missingError.message);
  });
});

describe("owners retain full access to their own notes", () => {
  it("reads, updates and deletes normally", async () => {
    const { ada, adasNote } = await scenario();

    expect(await getNote(ada.id, adasNote.id)).not.toBeNull();

    const updated = await updateNote(ada.id, adasNote.id, { body: "revised" });
    expect(updated.body).toBe("revised");

    await deleteNote(ada.id, adasNote.id);
    expect(await getNote(ada.id, adasNote.id)).toBeNull();
  });

  it("defaults new notes to private", async () => {
    const { adasNote } = await scenario();
    expect(adasNote.visibility).toBe(Visibility.private);
    expect(adasNote.shareToken).toBeNull();
  });
});

describe("two users, one shared recording", () => {
  it("keeps their notes and display overrides independent", async () => {
    const { ada, blue, recording, adasNote } = await scenario();

    await createNote(blue.id, {
      recordingId: recording.id,
      body: "Blue's note about the same song.",
      displayArtist: "Drake & PARTYNEXTDOOR",
    });

    const adaNotes = await listNotes(ada.id);
    const blueNotes = await listNotes(blue.id);

    expect(adaNotes).toHaveLength(1);
    expect(blueNotes).toHaveLength(1);
    expect(adaNotes[0]?.id).toBe(adasNote.id);
    expect(adaNotes[0]?.displayArtist).toBeNull();
    expect(blueNotes[0]?.displayArtist).toBe("Drake & PARTYNEXTDOOR");

    // The shared canonical row is unchanged by either of them.
    const shared = await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
    expect(shared.artistDisplay).toBe("PARTYNEXTDOOR & Drake");
  });
});

describe("playlist context cannot be borrowed from another user", () => {
  it("refuses a collection item belonging to someone else", async () => {
    const { ada, blue, recording } = await scenario();

    const adasCollection = await prisma.collection.create({
      data: {
        ownerId: ada.id,
        name: "Late night drives",
        items: { create: [{ recordingId: recording.id, position: 0 }] },
      },
      include: { items: true },
    });
    const itemId = adasCollection.items[0]!.id;

    await expect(
      createNote(blue.id, {
        recordingId: recording.id,
        body: "attaching to a stranger's collection",
        collectionItemId: itemId,
      }),
    ).rejects.toThrow(InvalidCollectionContextError);

    expect(await prisma.note.count({ where: { ownerId: blue.id } })).toBe(0);
  });

  it("refuses an item pointing at a different recording", async () => {
    const { ada, recording } = await scenario();

    const other = await prisma.recording.create({
      data: {
        title: "Whisper My Name",
        artistDisplay: "Drake",
        origin: RecordingOrigin.provider,
        normalizedKey: "v1:drake:whisper my name:45",
      },
    });

    const collection = await prisma.collection.create({
      data: {
        ownerId: ada.id,
        name: "Mismatch",
        items: { create: [{ recordingId: other.id, position: 0 }] },
      },
      include: { items: true },
    });

    await expect(
      createNote(ada.id, {
        recordingId: recording.id,
        body: "wrong song for this slot",
        collectionItemId: collection.items[0]!.id,
      }),
    ).rejects.toThrow(InvalidCollectionContextError);
  });

  it("accepts the owner's own matching item", async () => {
    const { ada, recording } = await scenario();

    const collection = await prisma.collection.create({
      data: {
        ownerId: ada.id,
        name: "Late night drives",
        items: { create: [{ recordingId: recording.id, position: 0 }] },
      },
      include: { items: true },
    });

    const note = await createNote(ada.id, {
      recordingId: recording.id,
      body: "the opening track sets the tone",
      collectionItemId: collection.items[0]!.id,
    });

    expect(note.collectionItemId).toBe(collection.items[0]!.id);
  });
});

describe("share tokens", () => {
  it("addresses a shared note by token rather than by its UUID", async () => {
    const { ada, adasNote } = await scenario();
    const published = await publishNoteUnlisted(ada.id, adasNote.id);

    expect(published.shareToken).toBeTruthy();
    expect(published.shareToken).not.toBe(published.id);
    expect(await getSharedNote(published.shareToken!)).not.toBeNull();
  });

  it("revokes access when the token is rotated", async () => {
    const { ada, adasNote } = await scenario();
    const published = await publishNoteUnlisted(ada.id, adasNote.id);
    const leaked = published.shareToken!;

    const rotated = await rotateShareToken(ada.id, adasNote.id);

    expect(await getSharedNote(leaked)).toBeNull();
    expect(await getSharedNote(rotated.shareToken!)).not.toBeNull();
  });

  /** Un-publishing must revoke, not merely hide the link. */
  it("revokes access when the note is unpublished", async () => {
    const { ada, adasNote } = await scenario();
    const published = await publishNoteUnlisted(ada.id, adasNote.id);
    const token = published.shareToken!;

    await unpublishNote(ada.id, adasNote.id);

    expect(await getSharedNote(token)).toBeNull();
  });

  it("does not expose a private note by token", async () => {
    const { adasNote } = await scenario();
    expect(adasNote.shareToken).toBeNull();
    expect(await getSharedNote("guessed-token")).toBeNull();
  });
});
