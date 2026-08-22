import { PrismaClient, Provider, RecordingOrigin } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyReconciliation, planReconciliation } from "@/lib/collections/reconcile";
import { createNote } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Refreshing a collection in place, without losing what was written about it.
 *
 * The old guarantee — "a collection is an immutable snapshot" — protected notes
 * absolutely by refusing to let a playlist change. Playlists change, so the rule
 * is reversed and the guarantee is now upheld directly. That makes this the
 * highest-risk logic in the product, and these are the cases that would ruin
 * somebody's archive if it were subtly wrong:
 *
 *   - a note follows its track when the order changes;
 *   - a note on the SECOND copy of a repeated track follows the second copy;
 *   - a note whose track is gone is orphaned, never deleted;
 *   - re-anchoring does not count as editing the note.
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
      items: {
        create: recordingIds.map((recordingId, position) => ({
          recordingId,
          position,
          occurrence: recordingIds.slice(0, position).filter((r) => r === recordingId).length,
        })),
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

/** Load the shape `planReconciliation` expects, in position order. */
async function existingFor(collectionId: string, ownerId: string) {
  const items = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { position: "asc" },
    include: { notes: { where: { ownerId }, select: { id: true, updatedAt: true } } },
  });
  return items.map((i) => ({
    id: i.id,
    recordingId: i.recordingId,
    position: i.position,
    notes: i.notes,
  }));
}

async function refresh(collectionId: string, ownerId: string, desired: string[]) {
  const plan = planReconciliation(
    await existingFor(collectionId, ownerId),
    desired.map((recordingId) => ({ recordingId })),
    "replace",
  );
  await prisma.$transaction((tx) => applyReconciliation(tx, collectionId, plan));
  return plan;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("planning a refresh", () => {
  it("counts what changes without needing a database", () => {
    const plan = planReconciliation(
      [
        { id: "1", recordingId: "a", position: 0, notes: [] },
        { id: "2", recordingId: "b", position: 1, notes: [] },
      ],
      [{ recordingId: "b" }, { recordingId: "c" }],
      "replace",
    );

    expect(plan.added).toBe(1); // c
    expect(plan.removed).toBe(1); // a
    expect(plan.moved).toBe(1); // b, 1 -> 0
    expect(plan.items.map((i) => i.recordingId)).toEqual(["b", "c"]);
  });

  it("numbers repeated tracks by appearance", () => {
    const plan = planReconciliation(
      [],
      [{ recordingId: "a" }, { recordingId: "b" }, { recordingId: "a" }],
      "replace",
    );
    expect(plan.items.map((i) => i.occurrence)).toEqual([0, 0, 1]);
  });

  it("appends without disturbing what is already there", () => {
    const plan = planReconciliation(
      [{ id: "1", recordingId: "a", position: 0, notes: [{ id: "n", updatedAt: new Date() }] }],
      [{ recordingId: "b" }],
      "append",
    );
    expect(plan.items.map((i) => i.recordingId)).toEqual(["a", "b"]);
    expect(plan.orphanedNoteIds).toEqual([]);
    expect(plan.items[0]!.notes.map((n) => n.id)).toEqual(["n"]);
  });
});

describe("refreshing a collection", () => {
  it("keeps a note on its track when the order changes", async () => {
    const user = await makeUser();
    const [a, b, c] = await Promise.all([
      makeRecording("CN TOWER"),
      makeRecording("Nokia"),
      makeRecording("Elsewhere"),
    ]);
    const collection = await makeCollection(user.id, [a.id, b.id]);

    const note = await createNote(user.id, {
      recordingId: b.id,
      collectionItemId: collection.items[1]!.id,
      body: "second one in, and it lands",
    });

    // Nokia moves to the end and a new track appears at the front.
    await refresh(collection.id, user.id, [c.id, a.id, b.id]);

    const after = await prisma.note.findUniqueOrThrow({
      where: { id: note.id },
      include: { collectionItem: true },
    });
    expect(after.collectionItem?.recordingId).toBe(b.id);
    expect(after.collectionItem?.position).toBe(2);
  });

  /** The case position alone cannot express and recording alone cannot either. */
  it("keeps a note on the SECOND copy of a repeated track", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("CN TOWER"), makeRecording("Nokia")]);
    const collection = await makeCollection(user.id, [a.id, b.id, a.id]);

    const onFirst = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: collection.items[0]!.id,
      body: "the opener",
    });
    const onSecond = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: collection.items[2]!.id,
      body: "and again at the end, which is the point",
    });

    // Same three tracks, reversed: the second CN TOWER is now first.
    await refresh(collection.id, user.id, [a.id, a.id, b.id]);

    const items = await prisma.collectionItem.findMany({
      where: { collectionId: collection.id },
      orderBy: { position: "asc" },
    });
    const first = await prisma.note.findUniqueOrThrow({ where: { id: onFirst.id } });
    const second = await prisma.note.findUniqueOrThrow({ where: { id: onSecond.id } });

    expect(first.collectionItemId).toBe(items[0]!.id);
    expect(second.collectionItemId).toBe(items[1]!.id);
    expect(items[1]!.occurrence).toBe(1);
  });

  it("orphans a note whose track is gone, and never deletes it", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("CN TOWER"), makeRecording("Nokia")]);
    const collection = await makeCollection(user.id, [a.id, b.id]);

    const note = await createNote(user.id, {
      recordingId: b.id,
      collectionItemId: collection.items[1]!.id,
      body: "about a track that gets removed",
    });

    const plan = await refresh(collection.id, user.id, [a.id]);

    expect(plan.orphanedNoteIds).toEqual([note.id]);
    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.body).toBe("about a track that gets removed");
    expect(after.recordingId).toBe(b.id);
    expect(after.collectionItemId).toBeNull();
  });

  it("drops a surplus note when the track appears fewer times than before", async () => {
    const user = await makeUser();
    const a = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [a.id, a.id]);

    const kept = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: collection.items[0]!.id,
      body: "on the first",
    });
    const surplus = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: collection.items[1]!.id,
      body: "on the second, which is about to disappear",
    });

    await refresh(collection.id, user.id, [a.id]);

    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: kept.id } })).collectionItemId,
    ).not.toBeNull();
    const orphan = await prisma.note.findUniqueOrThrow({ where: { id: surplus.id } });
    expect(orphan.collectionItemId).toBeNull();
    expect(orphan.body).toBe("on the second, which is about to disappear");
  });

  /**
   * A refresh moves a note's anchor; it does not rewrite the note. If this
   * failed, every note in a fifty-track playlist would claim to have been
   * edited today the first time somebody hit refresh.
   */
  it("does not count re-anchoring as editing the note", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("CN TOWER"), makeRecording("Nokia")]);
    const collection = await makeCollection(user.id, [a.id, b.id]);

    const note = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: collection.items[0]!.id,
      body: "written once",
    });
    const before = note.updatedAt;

    await refresh(collection.id, user.id, [b.id, a.id]);

    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.updatedAt.getTime()).toBe(before.getTime());
  });

  it("leaves notes in a different collection alone", async () => {
    const user = await makeUser();
    const a = await makeRecording("CN TOWER");
    const [one, two] = await Promise.all([
      makeCollection(user.id, [a.id]),
      makeCollection(user.id, [a.id]),
    ]);

    const elsewhere = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: two.items[0]!.id,
      body: "in the other collection",
    });

    await refresh(one.id, user.id, []);

    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: elsewhere.id } })).collectionItemId,
    ).toBe(two.items[0]!.id);
  });
});
