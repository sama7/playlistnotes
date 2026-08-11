import { PrismaClient, Provider, RecordingOrigin } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createNote } from "@/lib/notes/service";
import { listTags, normalizeTagName, notesByTag, parseTagInput, setNoteTags } from "@/lib/notes/tags";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * Tags, and the property that keeps them private: the unique constraint is
 * `(owner_id, name)`, so two users can hold the same word without ever seeing
 * each other's. "chill" meaning different things to different people is not a
 * conflict to resolve — it is two private filing systems.
 */

async function makeUser() {
  return prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
}

async function makeNote(ownerId: string, title = "CN TOWER") {
  const recording = await prisma.recording.create({
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
  return createNote(ownerId, { recordingId: recording.id, body: `about ${title}` });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("parsing what a user typed", () => {
  it("folds case and collapses whitespace so near-duplicates are one tag", () => {
    expect(normalizeTagName("  Late   Night ")).toBe("late night");
    expect(parseTagInput("Late Night, late  night, LATE NIGHT")).toEqual(["late night"]);
  });

  it("keeps punctuation, which distinguishes tags a user meant to distinguish", () => {
    expect(parseTagInput("sci-fi, lo-fi")).toEqual(["sci-fi", "lo-fi"]);
  });

  it("drops empties and caps the count", () => {
    expect(parseTagInput("a, , b,,c")).toEqual(["a", "b", "c"]);
    expect(parseTagInput(Array.from({ length: 30 }, (_, i) => `t${i}`).join(","))).toHaveLength(12);
  });
});

describe("setting tags on a note", () => {
  it("creates tags and attaches them", async () => {
    const user = await makeUser();
    const note = await makeNote(user.id);

    await setNoteTags(user.id, note.id, ["late night", "drive"]);

    expect((await listTags(user.id)).map((t) => t.name).sort()).toEqual(["drive", "late night"]);
    expect(await notesByTag(user.id, "drive")).toHaveLength(1);
  });

  /** The field holds the whole set, so a removed word must actually go away. */
  it("replaces rather than merges", async () => {
    const user = await makeUser();
    const note = await makeNote(user.id);

    await setNoteTags(user.id, note.id, ["one", "two"]);
    await setNoteTags(user.id, note.id, ["two", "three"]);

    const names = (await listTags(user.id)).map((t) => t.name).sort();
    expect(names).toEqual(["three", "two"]);
    expect(await notesByTag(user.id, "one")).toHaveLength(0);
  });

  /** Otherwise the tag list only ever grows and fills with dead labels. */
  it("removes a tag once no note uses it", async () => {
    const user = await makeUser();
    const note = await makeNote(user.id);

    await setNoteTags(user.id, note.id, ["ephemeral"]);
    expect(await listTags(user.id)).toHaveLength(1);

    await setNoteTags(user.id, note.id, []);
    expect(await listTags(user.id)).toHaveLength(0);
  });

  it("reuses one tag row across several notes and counts them", async () => {
    const user = await makeUser();
    const [a, b] = await Promise.all([makeNote(user.id, "First"), makeNote(user.id, "Second")]);

    await setNoteTags(user.id, a.id, ["shared"]);
    await setNoteTags(user.id, b.id, ["shared"]);

    const tags = await listTags(user.id);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: "shared", count: 2 });
  });

  it("is idempotent", async () => {
    const user = await makeUser();
    const note = await makeNote(user.id);

    await setNoteTags(user.id, note.id, ["same"]);
    await setNoteTags(user.id, note.id, ["same"]);

    expect(await listTags(user.id)).toHaveLength(1);
    expect(await notesByTag(user.id, "same")).toHaveLength(1);
  });
});

describe("tags are private to their owner", () => {
  it("lets two users hold the same word independently", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const [aliceNote, bobNote] = await Promise.all([makeNote(alice.id), makeNote(bob.id)]);

    await setNoteTags(alice.id, aliceNote.id, ["chill"]);
    await setNoteTags(bob.id, bobNote.id, ["chill"]);

    // Two rows, not one shared row — the constraint is (owner_id, name).
    expect(await prisma.tag.count()).toBe(2);
    expect(await listTags(alice.id)).toHaveLength(1);
    expect(await notesByTag(alice.id, "chill")).toHaveLength(1);
    expect(await notesByTag(bob.id, "chill")).toHaveLength(1);
  });

  it("never returns another user's note under a shared tag name", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const aliceNote = await makeNote(alice.id, "Alice's track");
    await setNoteTags(alice.id, aliceNote.id, ["chill"]);

    expect(await notesByTag(bob.id, "chill")).toHaveLength(0);
    expect(await listTags(bob.id)).toHaveLength(0);
  });

  /** The acceptance criterion: a valid id belonging to someone else. */
  it("refuses to tag another user's note", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const aliceNote = await makeNote(alice.id);

    await expect(setNoteTags(bob.id, aliceNote.id, ["hijack"])).rejects.toThrow();

    expect(await prisma.tag.count()).toBe(0);
    expect(await prisma.noteTag.count()).toBe(0);
  });

  it("does not let one user's cleanup delete another user's tag", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const [aliceNote, bobNote] = await Promise.all([makeNote(alice.id), makeNote(bob.id)]);

    await setNoteTags(alice.id, aliceNote.id, ["keep"]);
    await setNoteTags(bob.id, bobNote.id, ["keep"]);

    // Alice clears hers, which triggers the orphan sweep.
    await setNoteTags(alice.id, aliceNote.id, []);

    expect(await listTags(alice.id)).toHaveLength(0);
    expect(await listTags(bob.id)).toHaveLength(1);
  });
});
