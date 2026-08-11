import { PrismaClient, Provider, RecordingOrigin, Visibility } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getCollection,
  getSharedCollection,
  publishCollectionUnlisted,
  rotateCollectionShareToken,
  unpublishCollection,
} from "@/lib/collections/service";
import { createNote, publishNoteUnlisted } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Sharing a collection, and the invariant that makes it safe to offer at all:
 * **publishing a collection never publishes the notes inside it.**
 *
 * That is a definition-of-done item, and it is the one most likely to be broken
 * later by someone adding a convenient `include` to a shared query. So the
 * tests below do not settle for "the returned object has no notes field" — they
 * put a real private note on a real shared collection and then search the whole
 * serialised payload for its text.
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
      name: "Late night",
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

describe("publishing a collection", () => {
  it("mints a share token and flips visibility", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    expect(collection.visibility).toBe(Visibility.private);
    expect(collection.shareToken).toBeNull();

    const published = await publishCollectionUnlisted(user.id, collection.id);
    expect(published.visibility).toBe(Visibility.unlisted);
    expect(published.shareToken).toBeTruthy();
    expect(published.shareToken!.length).toBeGreaterThan(20);
  });

  it("serves the tracklist in order to an anonymous reader", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("First"), makeRecording("Second")]);
    const collection = await makeCollection(user.id, [a.id, b.id]);
    const published = await publishCollectionUnlisted(user.id, collection.id);

    const shared = await getSharedCollection(published.shareToken!);
    expect(shared).not.toBeNull();
    expect(shared!.tracks.map((t) => t.title)).toEqual(["First", "Second"]);
  });
});

describe("a published collection never exposes a private note", () => {
  /**
   * The acceptance criterion, checked against the serialised payload rather
   * than the object's shape — an `include` added later would be caught by this
   * and missed by a shape assertion.
   */
  it("does not carry note text in the shared payload", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    const SECRET = "this sentence must never reach an anonymous reader";
    await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: SECRET,
    });

    const published = await publishCollectionUnlisted(user.id, collection.id);
    const shared = await getSharedCollection(published.shareToken!);

    expect(shared).not.toBeNull();
    expect(JSON.stringify(shared)).not.toContain(SECRET);
    expect(JSON.stringify(shared)).not.toContain("note");
  });

  it("still hides the note when the note itself was separately published", async () => {
    /**
     * The subtler case. A note published on its own is reachable at its own
     * share URL — that was the owner's deliberate choice. It must still not
     * appear on the collection page, because those are two separate decisions
     * and only one of them was made about this surface.
     */
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    const SHARED_NOTE = "published on its own, deliberately";
    const note = await createNote(user.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: SHARED_NOTE,
    });
    await publishNoteUnlisted(user.id, note.id);

    const published = await publishCollectionUnlisted(user.id, collection.id);
    const shared = await getSharedCollection(published.shareToken!);

    expect(JSON.stringify(shared)).not.toContain(SHARED_NOTE);
  });

  it("leaks no owner id, collection id, or internal identifier", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);
    const published = await publishCollectionUnlisted(user.id, collection.id);

    const payload = JSON.stringify(await getSharedCollection(published.shareToken!));
    expect(payload).not.toContain(user.id);
    expect(payload).not.toContain(collection.id);
    expect(payload).not.toContain(recording.id);
    expect(payload).not.toContain(user.authSubject);
  });
});

describe("revoking access", () => {
  it("un-publishing revokes the old link rather than hiding it", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);
    const published = await publishCollectionUnlisted(user.id, collection.id);
    const token = published.shareToken!;

    expect(await getSharedCollection(token)).not.toBeNull();

    await unpublishCollection(user.id, collection.id);
    expect(await getSharedCollection(token)).toBeNull();
  });

  it("rotating breaks the previous link immediately", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);
    const published = await publishCollectionUnlisted(user.id, collection.id);
    const oldToken = published.shareToken!;

    const rotated = await rotateCollectionShareToken(user.id, collection.id);
    expect(rotated.shareToken).not.toBe(oldToken);
    expect(await getSharedCollection(oldToken)).toBeNull();
    expect(await getSharedCollection(rotated.shareToken!)).not.toBeNull();
  });

  it("re-publishing after un-publishing does not resurrect the old token", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);

    const first = await publishCollectionUnlisted(user.id, collection.id);
    await unpublishCollection(user.id, collection.id);
    const second = await publishCollectionUnlisted(user.id, collection.id);

    expect(second.shareToken).not.toBe(first.shareToken);
    expect(await getSharedCollection(first.shareToken!)).toBeNull();
  });
});

describe("cross-user denial, with valid identifiers", () => {
  it("refuses to publish another user's collection", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);

    await expect(publishCollectionUnlisted(bob.id, collection.id)).rejects.toThrow();

    const after = await getCollection(alice.id, collection.id);
    expect(after!.visibility).toBe(Visibility.private);
    expect(after!.shareToken).toBeNull();
  });

  it("refuses to un-publish or rotate another user's collection", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);
    const published = await publishCollectionUnlisted(alice.id, collection.id);

    await expect(unpublishCollection(bob.id, collection.id)).rejects.toThrow();
    await expect(rotateCollectionShareToken(bob.id, collection.id)).rejects.toThrow();

    // Alice's link still works — Bob changed nothing.
    expect(await getSharedCollection(published.shareToken!)).not.toBeNull();
  });

  it("returns nothing for a well-formed token that belongs to no collection", async () => {
    expect(await getSharedCollection("Zm9vYmFyYmF6cXV4MDAwMDAwMDAwMDAw")).toBeNull();
  });
});
