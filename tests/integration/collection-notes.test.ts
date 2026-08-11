import { PrismaClient, Provider, RecordingOrigin } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createNote, listNotes } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Notes written **in the context of a collection item**.
 *
 * `notes.collection_item_id` is the schema's answer to a real distinction: a
 * note about "this song, third into this playlist" is not the same statement as
 * a note about the recording in the abstract. The collection page now writes
 * these, which means it accepts a collection item id from a browser — a new
 * client-supplied identifier, and therefore a new place to prove cross-user
 * denial with a **valid** id rather than a malformed one.
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
      name: "A snapshot",
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

describe("a note can be anchored to a collection item", () => {
  it("keeps the playlist context alongside the recording", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);
    const item = collection.items[0]!;

    const note = await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: item.id,
      body: "The city sounds under the intro are why this playlist starts here.",
    });

    expect(note.collectionItemId).toBe(item.id);
    expect(note.recordingId).toBe(recording.id);
    expect(note.visibility).toBe("private");
  });

  /**
   * The distinction the column exists for: the same recording, annotated twice,
   * once in context and once not. Both are the user's and both survive.
   */
  it("allows a contextual note and a standalone note on one recording", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: "third into this playlist, it lands differently",
    });
    await createNote(user.id, { recordingId: recording.id, body: "on its own it is just sad" });

    const notes = await listNotes(user.id);
    expect(notes).toHaveLength(2);
    expect(notes.filter((n) => n.collectionItemId !== null)).toHaveLength(1);
  });

  it("preserves a duplicated track as two independently annotatable items", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    // The same recording twice, which a real playlist may legitimately do.
    const collection = await makeCollection(user.id, [recording.id, recording.id]);

    await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: "the opener",
    });
    await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[1]!.id,
      body: "and again at the end, on purpose",
    });

    const notes = await listNotes(user.id);
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.collectionItemId)).size).toBe(2);
  });
});

describe("cross-user denial, with valid identifiers", () => {
  /**
   * The acceptance criterion is specifically about **valid** UUIDs belonging to
   * someone else — a malformed id proves nothing, because it fails parsing
   * rather than authorization.
   */
  it("refuses to anchor a note to another user's collection item", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const aliceCollection = await makeCollection(alice.id, [recording.id]);
    const aliceItem = aliceCollection.items[0]!;

    await expect(
      createNote(bob.id, {
        recordingId: recording.id,
        collectionItemId: aliceItem.id,
        body: "not mine to annotate",
      }),
    ).rejects.toThrow();

    expect(await prisma.note.count()).toBe(0);
  });

  /**
   * The subtler attack: a real item of your own, paired with a recording that
   * is not the one the item holds. Accepting it would file a note under a track
   * it is not about.
   */
  it("refuses an item paired with the wrong recording", async () => {
    const user = await makeUser();
    const [inPlaylist, elsewhere] = await Promise.all([
      makeRecording("CN TOWER"),
      makeRecording("Something Else"),
    ]);
    const collection = await makeCollection(user.id, [inPlaylist.id]);

    await expect(
      createNote(user.id, {
        recordingId: elsewhere.id,
        collectionItemId: collection.items[0]!.id,
        body: "mismatched",
      }),
    ).rejects.toThrow();

    expect(await prisma.note.count()).toBe(0);
  });

  it("does not let one user's contextual note appear in another's list", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);

    await createNote(alice.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: "alice's private thought",
    });

    expect(await listNotes(bob.id)).toHaveLength(0);
    expect(await listNotes(alice.id)).toHaveLength(1);
  });
});

describe("re-import never disturbs an existing note", () => {
  /**
   * A definition-of-done item. Imports are immutable snapshots, so a second
   * import of the same playlist creates new items; the note stays attached to
   * the item it was written against, at the position it was written against.
   */
  it("leaves the note on the original snapshot's item", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("First"), makeRecording("Second")]);

    const first = await makeCollection(user.id, [a.id, b.id]);
    const note = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: first.items[0]!.id,
      body: "written against snapshot one",
    });

    // A later import with the order reversed — the case that would corrupt
    // meaning if items were mutated in place.
    const second = await makeCollection(user.id, [b.id, a.id]);

    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.collectionItemId).toBe(first.items[0]!.id);
    expect(after.recordingId).toBe(a.id);

    const stillFirst = await prisma.collectionItem.findUniqueOrThrow({
      where: { id: first.items[0]!.id },
    });
    expect(stillFirst.position).toBe(0);
    expect(stillFirst.recordingId).toBe(a.id);
    expect(second.items[0]!.recordingId).toBe(b.id);
  });
});
