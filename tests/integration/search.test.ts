import { PrismaClient, Provider } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchNotes } from "@/lib/notes/search";
import { createCollectionNote, createNote } from "@/lib/notes/service";
import { resolveByProviderId } from "@/lib/music/resolve-recording";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

async function fixture() {
  const ada = await prisma.user.create({
    data: { authSubject: `ada_${crypto.randomUUID()}`, username: "ada" },
  });
  const blue = await prisma.user.create({
    data: { authSubject: `blue_${crypto.randomUUID()}`, username: "blue" },
  });

  const cnTower = (
    await resolveByProviderId({
      provider: Provider.spotify,
      providerId: "4u43I0LP2Xf85OAS85eG0R",
      title: "CN TOWER",
      artistDisplay: "PARTYNEXTDOOR & Drake",
    })
  ).recording;

  const darling = (
    await resolveByProviderId({
      provider: Provider.spotify,
      providerId: "0VaeksJaXy5R1nvcTMh3Xk",
      title: "Darling, I",
      artistDisplay: "Tyler, The Creator",
    })
  ).recording;

  await createNote(ada.id, {
    recordingId: cnTower.id,
    body: "The city sounds under the intro are why this playlist starts here.",
  });
  await createNote(ada.id, {
    recordingId: darling.id,
    body: "Sent this to the group chat after the third listen.",
  });

  return { ada, blue, cnTower, darling };
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("searchNotes", () => {
  it("finds a note by words in its body", async () => {
    const { ada } = await fixture();
    const results = await searchNotes(ada.id, "city sounds");
    expect(results).toHaveLength(1);
    expect(results[0]?.body).toContain("city sounds");
  });

  /** People look for "that Drake note" far more than they recall their own
   *  wording, so the recording is searchable too. */
  it("finds a note by artist, which never appears in the note text", async () => {
    const { ada } = await fixture();
    const results = await searchNotes(ada.id, "Drake");
    expect(results).toHaveLength(1);
    expect(results[0]?.recordingTitle).toBe("CN TOWER");
  });

  it("finds a note by track title", async () => {
    const { ada } = await fixture();
    expect(await searchNotes(ada.id, "Darling")).toHaveLength(1);
  });

  it("stems, so 'listening' matches 'listen'", async () => {
    const { ada } = await fixture();
    expect((await searchNotes(ada.id, "listening")).length).toBeGreaterThan(0);
  });

  it("ranks a body match above a metadata match", async () => {
    const { ada, cnTower } = await fixture();
    await createNote(ada.id, { recordingId: cnTower.id, body: "tyler played this at the show" });

    const results = await searchNotes(ada.id, "tyler");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The note that actually says "tyler" outranks the one merely by Tyler.
    expect(results[0]?.body).toContain("tyler");
  });

  /**
   * The property that matters most. Scoping happens in the WHERE clause, so
   * search cannot become a way to read another user's private writing.
   */
  it("never returns another user's notes", async () => {
    const { ada, blue, cnTower } = await fixture();
    await createNote(blue.id, {
      recordingId: cnTower.id,
      body: "Blue's private thoughts about the city sounds in this intro",
    });

    const adaResults = await searchNotes(ada.id, "city sounds");
    const blueResults = await searchNotes(blue.id, "city sounds");

    expect(adaResults).toHaveLength(1);
    expect(blueResults).toHaveLength(1);
    expect(adaResults[0]?.id).not.toBe(blueResults[0]?.id);
    expect(adaResults[0]?.body).not.toContain("Blue's private");
  });

  it("returns nothing for a user with no notes at all", async () => {
    const { blue } = await fixture();
    expect(await searchNotes(blue.id, "city sounds")).toEqual([]);
  });

  /** websearch_to_tsquery tolerates what people actually type; to_tsquery
   *  would throw on several of these. */
  it.each(['"city sounds"', "city or chat", "city -chat", "!!!", "  ", "a'b\"c)("])(
    "does not throw on input %j",
    async (q) => {
      const { ada } = await fixture();
      await expect(searchNotes(ada.id, q)).resolves.toBeInstanceOf(Array);
    },
  );

  it("cannot be coaxed into returning rows by SQL in the query text", async () => {
    const { ada } = await fixture();
    const results = await searchNotes(ada.id, "' OR 1=1 --");
    expect(results).toEqual([]);
  });
});

/**
 * A note about a collection has no recording, and the search query joins to
 * `recordings`. An inner join there silently drops every collection-level note
 * from search — findable-later is the one promise this product makes, so the
 * join type is asserted rather than assumed.
 */
describe("searchNotes over collection-level notes", () => {
  it("finds a note about a collection, matching on its own words", async () => {
    const { ada } = await fixture();
    const collection = await prisma.collection.create({
      data: { ownerId: ada.id, name: "August, mostly at night" },
    });
    await createCollectionNote(ada.id, {
      collectionId: collection.id,
      body: "the drive home tape",
    });

    const results = await searchNotes(ada.id, "drive home");

    expect(results).toHaveLength(1);
    expect(results[0]!.recordingTitle).toBe("August, mostly at night");
  });

  it("finds it by the collection's name too", async () => {
    const { ada } = await fixture();
    const collection = await prisma.collection.create({
      data: { ownerId: ada.id, name: "Reykjavik" },
    });
    await createCollectionNote(ada.id, {
      collectionId: collection.id,
      body: "played this end to end on the bus",
    });

    expect(await searchNotes(ada.id, "Reykjavik")).toHaveLength(1);
  });

  it("still does not leak it to another user", async () => {
    const { ada, blue } = await fixture();
    const collection = await prisma.collection.create({
      data: { ownerId: ada.id, name: "Reykjavik" },
    });
    await createCollectionNote(ada.id, { collectionId: collection.id, body: "private thought" });

    expect(await searchNotes(blue.id, "Reykjavik")).toHaveLength(0);
    expect(await searchNotes(blue.id, "private thought")).toHaveLength(0);
  });
});
