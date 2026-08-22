import { PrismaClient, Provider, RecordingOrigin, Visibility } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CollectionNotFoundError,
  deleteCollection,
  updateCollection,
} from "@/lib/collections/service";
import { createCollectionNote, createNote, NoteNotFoundError } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Renaming and deleting a collection, and the note that is about the collection
 * itself.
 *
 * Two properties carry real risk and are asserted directly rather than assumed:
 *
 *  1. **Deleting a collection must not delete the writing.** Notes anchored to
 *     a collection *item* survive as notes about their track, because
 *     `collection_item_id` is `ON DELETE SET NULL`. If that FK were ever
 *     tightened to a cascade, this suite fails instead of a user silently
 *     losing months of notes.
 *  2. **A note is about exactly one subject.** The `notes_exactly_one_subject`
 *     CHECK is a database constraint, not a convention, so it is exercised here
 *     against the real column rather than trusted from the schema file.
 */

async function makeUser() {
  return prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
}

async function makeRecording(title: string) {
  return prisma.recording.create({
    data: {
      title,
      artistDisplay: "Test Artist",
      origin: RecordingOrigin.provider,
      normalizedKey: `k_${crypto.randomUUID()}`,
      externalIds: {
        create: { provider: Provider.spotify, providerId: `p_${crypto.randomUUID()}` },
      },
    },
  });
}

async function makeCollection(ownerId: string, recordingIds: string[]) {
  return prisma.collection.create({
    data: {
      ownerId,
      name: "aug23",
      items: { create: recordingIds.map((recordingId, position) => ({ recordingId, position })) },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a note about the collection itself", () => {
  it("is stored against the collection and not against any track", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    const note = await createCollectionNote(user.id, {
      collectionId: collection.id,
      body: "This one got me through February.",
    });

    expect(note.collectionId).toBe(collection.id);
    expect(note.recordingId).toBeNull();
    expect(note.visibility).toBe(Visibility.private);
  });

  it("refuses a collection belonging to someone else, given its real UUID", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);

    await expect(
      createCollectionNote(bob.id, { collectionId: collection.id, body: "mine now" }),
    ).rejects.toThrow(NoteNotFoundError);

    expect(await prisma.note.count()).toBe(0);
  });

  /** The CHECK constraint, exercised against the database rather than assumed. */
  it("cannot be about a recording and a collection at once", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    await expect(
      prisma.note.create({
        data: {
          ownerId: user.id,
          recordingId: recording.id,
          collectionId: collection.id,
          body: "both at once",
        },
      }),
    ).rejects.toThrow();
  });

  it("cannot be about nothing at all", async () => {
    const user = await makeUser();

    await expect(
      prisma.note.create({ data: { ownerId: user.id, body: "attached to nothing" } }),
    ).rejects.toThrow();
  });
});

describe("renaming a collection", () => {
  it("changes the label and leaves the snapshot alone", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("CN TOWER"), makeRecording("Nokia")]);
    const collection = await makeCollection(user.id, [a.id, b.id]);

    await updateCollection(user.id, collection.id, {
      name: "August, mostly at night",
      description: "the drive home",
    });

    const after = await prisma.collection.findUniqueOrThrow({
      where: { id: collection.id },
      include: { items: { orderBy: { position: "asc" } } },
    });
    expect(after.name).toBe("August, mostly at night");
    expect(after.description).toBe("the drive home");
    expect(after.items.map((i) => i.recordingId)).toEqual([a.id, b.id]);
  });

  it("refuses another user's collection, given its real UUID", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);

    await expect(
      updateCollection(bob.id, collection.id, { name: "bob's now" }),
    ).rejects.toThrow(CollectionNotFoundError);

    expect(
      (await prisma.collection.findUniqueOrThrow({ where: { id: collection.id } })).name,
    ).toBe("aug23");
  });
});

describe("deleting a collection", () => {
  it("keeps notes written about its tracks, as notes about those tracks", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    const note = await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: "third one in, and it lands every time",
    });

    await deleteCollection(user.id, collection.id);

    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.body).toBe("third one in, and it lands every time");
    expect(after.recordingId).toBe(recording.id);
    // The context is gone because the collection is; the writing is not.
    expect(after.collectionItemId).toBeNull();
  });

  it("removes the note that was about the collection itself", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);
    const note = await createCollectionNote(user.id, {
      collectionId: collection.id,
      body: "about the whole thing",
    });

    await deleteCollection(user.id, collection.id);

    expect(await prisma.note.findUnique({ where: { id: note.id } })).toBeNull();
  });

  it("leaves the recordings themselves alone", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    await deleteCollection(user.id, collection.id);

    expect(await prisma.recording.findUnique({ where: { id: recording.id } })).not.toBeNull();
  });

  it("refuses another user's collection, given its real UUID", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);

    await expect(deleteCollection(bob.id, collection.id)).rejects.toThrow(
      CollectionNotFoundError,
    );
    expect(await prisma.collection.findUnique({ where: { id: collection.id } })).not.toBeNull();
  });
});
