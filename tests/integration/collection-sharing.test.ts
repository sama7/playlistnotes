import { PrismaClient, Provider, RecordingOrigin, Visibility } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getCollection,
  getSharedCollection,
  publishCollectionUnlisted,
  setCollectionVisibility,
  setSharedNotes,
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
    // The payload now HAS a notes field per track, because selected notes can
    // travel — so the assertion is that it is empty, not that the word is
    // absent. Nothing was ticked, so nothing goes.
    expect(shared!.tracks.every((t) => t.notes.length === 0)).toBe(true);
    expect(shared!.about).toBeNull();
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

  it("keeps the same link when an unlisted collection is made public", async () => {
    const user = await makeUser();
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(user.id, [recording.id]);
    const unlisted = await publishCollectionUnlisted(user.id, collection.id);

    const madePublic = await setCollectionVisibility(user.id, collection.id, Visibility.public);

    expect(madePublic.shareToken).toBe(unlisted.shareToken);
    expect(await getSharedCollection(madePublic.shareToken!)).not.toBeNull();
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

  it("refuses to un-publish or re-share another user's collection", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);
    const published = await publishCollectionUnlisted(alice.id, collection.id);

    await expect(unpublishCollection(bob.id, collection.id)).rejects.toThrow();
    await expect(
      setCollectionVisibility(bob.id, collection.id, Visibility.public),
    ).rejects.toThrow();

    // Alice's link still works — Bob changed nothing.
    expect(await getSharedCollection(published.shareToken!)).not.toBeNull();
  });

  it("returns nothing for a well-formed token that belongs to no collection", async () => {
    expect(await getSharedCollection("Zm9vYmFyYmF6cXV4MDAwMDAwMDAwMDAw")).toBeNull();
  });
});

/**
 * Selective sharing: the owner picks which notes travel with a collection.
 *
 * This is the invariant in its new form. It used to be guaranteed by the shared
 * view being structurally incapable of returning a note; now notes can travel,
 * so the guarantee has to be tested rather than asserted by construction. Three
 * things must hold, and all three are failures a user would experience as a
 * betrayal:
 *
 *   - nothing travels unless it was explicitly ticked;
 *   - un-ticking actually withdraws it;
 *   - taking the collection private withdraws everything.
 */
describe("choosing which notes travel with a shared collection", () => {
  async function scenario() {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeRecording("CN TOWER"), makeRecording("Nokia")]);
    const collection = await makeCollection(user.id, [a.id, b.id]);

    const kept = await createNote(user.id, {
      recordingId: a.id,
      collectionItemId: collection.items[0]!.id,
      body: "the one I am happy to show",
    });
    const secret = await createNote(user.id, {
      recordingId: b.id,
      collectionItemId: collection.items[1]!.id,
      body: "the one that stays mine",
    });

    const published = await publishCollectionUnlisted(user.id, collection.id);
    return { user, collection, kept, secret, token: published.shareToken! };
  }

  it("carries only the ticked note, and publishes it", async () => {
    const { user, collection, kept, secret, token } = await scenario();

    await setSharedNotes(user.id, collection.id, [kept.id]);
    const shared = await getSharedCollection(token);

    expect(shared!.tracks[0]!.notes).toEqual(["the one I am happy to show"]);
    expect(shared!.tracks[1]!.notes).toEqual([]);
    expect(JSON.stringify(shared)).not.toContain("the one that stays mine");

    // A note on a public page cannot still claim to be private in the owner's
    // own list — that would be a lie in one place or the other.
    const after = await prisma.note.findUniqueOrThrow({ where: { id: kept.id } });
    expect(after.visibility).toBe(Visibility.unlisted);
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: secret.id } })).visibility,
    ).toBe(Visibility.private);
  });

  it("withdraws a note when it is un-ticked", async () => {
    const { user, collection, kept, token } = await scenario();

    await setSharedNotes(user.id, collection.id, [kept.id]);
    await setSharedNotes(user.id, collection.id, []);

    expect((await getSharedCollection(token))!.tracks[0]!.notes).toEqual([]);
  });

  it("withdraws every note when the collection goes private", async () => {
    const { user, collection, kept, token } = await scenario();
    await setSharedNotes(user.id, collection.id, [kept.id]);

    await unpublishCollection(user.id, collection.id);

    expect(await getSharedCollection(token)).toBeNull();
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: kept.id } })).sharedInCollection,
    ).toBe(false);
  });

  it("refuses to tick a note in another user's collection", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const recording = await makeRecording("CN TOWER");
    const collection = await makeCollection(alice.id, [recording.id]);
    const note = await createNote(alice.id, {
      recordingId: recording.id,
      collectionItemId: collection.items[0]!.id,
      body: "alice wrote this",
    });

    await expect(setSharedNotes(bob.id, collection.id, [note.id])).rejects.toThrow();
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).sharedInCollection,
    ).toBe(false);
  });

  it("ignores a note id from outside the collection", async () => {
    const { user, collection, token } = await scenario();
    const other = await makeRecording("Elsewhere");
    const unrelated = await createNote(user.id, {
      recordingId: other.id,
      body: "not part of this collection at all",
    });

    await setSharedNotes(user.id, collection.id, [unrelated.id]);

    const shared = await getSharedCollection(token);
    expect(JSON.stringify(shared)).not.toContain("not part of this collection at all");
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: unrelated.id } })).sharedInCollection,
    ).toBe(false);
  });
});
