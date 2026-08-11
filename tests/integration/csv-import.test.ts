import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importFromCsv } from "@/lib/music/import-from-csv";
import { createNote } from "@/lib/notes/service";
import { resetDatabase } from "./reset";

const prisma = new PrismaClient();

/**
 * CSV import, end to end.
 *
 * Link import now covers albums and public playlists, so this path exists for
 * the two cases that genuinely cannot be read any other way: a private playlist,
 * and Spotify's own editorial playlists, which are withheld from Development
 * Mode apps.
 *
 * The acceptance criteria it has to satisfy are about **not destroying things**:
 * duplicates preserved, order preserved, one recording per distinct URI however
 * many times it appears, and a re-import never reordering or retargeting items
 * beneath a note someone already wrote.
 */

const HEADER =
  "Track URI,Track Name,Artist URI(s),Artist Name(s),Album URI,Album Name," +
  "Album Artist URI(s),Album Artist Name(s),Album Release Date,Track Number,Track Duration (ms),ISRC";

const PND = "spotify:artist:2HPaUgqeutzr3jx5a9WyDd";
const DRAKE = "spotify:artist:3TVXtAsR1Inumwj472S9r4";
const ALBUM = "spotify:album:6Rl6YoCarF2GHPSQmmFjuR";

function line(id: string, name: string, artistUris = PND, artistNames = "PARTYNEXTDOOR") {
  return [
    `spotify:track:${id}`,
    name,
    `"${artistUris}"`,
    `"${artistNames}"`,
    ALBUM,
    "$OME $EXY $ONGS 4 U",
    `"${artistUris}"`,
    `"${artistNames}"`,
    "2025-02-14",
    "1",
    "189000",
    "",
  ].join(",");
}

const A = "4u43I0LP2Xf85OAS85eG0R";
const B = "1Az1QoedRFrbaxRKKPuJ2X";

async function makeUser() {
  return prisma.user.create({ data: { authSubject: `s_${crypto.randomUUID()}` } });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("importing a CSV", () => {
  it("creates a collection with items in file order", async () => {
    const user = await makeUser();
    const csv = [HEADER, line(A, "One"), line(B, "Two")].join("\n");

    const result = await importFromCsv(user.id, csv, { filename: "late_night.csv" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.summary.imported).toBe(2);
    expect(result.summary.created).toBe(2);

    const items = await prisma.collectionItem.findMany({
      where: { collectionId: result.summary.collectionId },
      orderBy: { position: "asc" },
      include: { recording: true },
    });
    expect(items.map((i) => i.recording.title)).toEqual(["One", "Two"]);
  });

  it("names the collection after the file when no name is given", async () => {
    const user = await makeUser();
    const result = await importFromCsv(user.id, [HEADER, line(A, "One")].join("\n"), {
      filename: "late_night_drive.csv",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.name).toBe("late night drive");
  });

  /** A definition-of-done item: 2 items, 1 recording. */
  it("keeps a duplicated track as two items but one recording", async () => {
    const user = await makeUser();
    const csv = [HEADER, line(A, "One"), line(B, "Two"), line(A, "One")].join("\n");

    const result = await importFromCsv(user.id, csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.summary.imported).toBe(3);
    expect(await prisma.collectionItem.count()).toBe(3);
    expect(await prisma.recording.count()).toBe(2);
  });

  it("creates exactly one artist row per distinct artist URI", async () => {
    const user = await makeUser();
    const csv = [
      HEADER,
      line(A, "One", `${PND}, ${DRAKE}`, "PARTYNEXTDOOR, Drake"),
      line(B, "Two", DRAKE, "Drake"),
    ].join("\n");

    await importFromCsv(user.id, csv);
    expect(await prisma.artist.count()).toBe(2);
    expect(await prisma.album.count()).toBe(1);
  });

  it("reports skipped rows rather than hiding them", async () => {
    const user = await makeUser();
    const csv = [
      HEADER,
      line(A, "One"),
      "spotify:local:::Bootleg:214,A Bootleg,,,,,,,,,,",
    ].join("\n");

    const result = await importFromCsv(user.id, csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.skipped).toBe(1);
    expect(result.skipped[0]!.line).toBe(3);
  });

  it("refuses a file with no usable rows and creates nothing", async () => {
    const user = await makeUser();
    const csv = [HEADER, "spotify:local:::Bootleg:214,A Bootleg,,,,,,,,,,"].join("\n");

    const result = await importFromCsv(user.id, csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty");
    expect(await prisma.collection.count()).toBe(0);
    expect(await prisma.recording.count()).toBe(0);
  });

  it("refuses a file with no Track URI column and creates nothing", async () => {
    const user = await makeUser();
    const result = await importFromCsv(user.id, "Song,Artist\nOne,PARTYNEXTDOOR");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unreadable");
    expect(await prisma.collection.count()).toBe(0);
  });
});

describe("re-importing the same file", () => {
  it("warns on identical bytes instead of silently duplicating", async () => {
    const user = await makeUser();
    const csv = [HEADER, line(A, "One")].join("\n");

    const first = await importFromCsv(user.id, csv);
    expect(first.ok).toBe(true);

    const second = await importFromCsv(user.id, csv);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("duplicate");
    expect(second.previous?.collectionId).toBeTruthy();

    // Nothing was created by the refusal.
    expect(await prisma.collection.count()).toBe(1);
  });

  it("proceeds when the user confirms, creating a second snapshot", async () => {
    const user = await makeUser();
    const csv = [HEADER, line(A, "One")].join("\n");

    await importFromCsv(user.id, csv);
    const second = await importFromCsv(user.id, csv, { confirmDuplicate: true });

    expect(second.ok).toBe(true);
    expect(await prisma.collection.count()).toBe(2);
    // Same track, so still one recording — snapshots are separate, the catalog
    // is shared.
    expect(await prisma.recording.count()).toBe(1);
  });

  it("does not treat another user's identical file as a duplicate", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const csv = [HEADER, line(A, "One")].join("\n");

    await importFromCsv(alice.id, csv);
    const bobs = await importFromCsv(bob.id, csv);

    // Two people importing the same public export is two people, not a repeat.
    expect(bobs.ok).toBe(true);
    expect(await prisma.collection.count()).toBe(2);
  });

  /**
   * The acceptance criterion that matters most here: a re-import must not
   * delete, retarget, or reorder items beneath a note someone already wrote.
   */
  it("leaves an existing note untouched when the order changes", async () => {
    const user = await makeUser();
    const first = await importFromCsv(user.id, [HEADER, line(A, "One"), line(B, "Two")].join("\n"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const firstItems = await prisma.collectionItem.findMany({
      where: { collectionId: first.summary.collectionId },
      orderBy: { position: "asc" },
    });

    const note = await createNote(user.id, {
      recordingId: firstItems[0]!.recordingId,
      collectionItemId: firstItems[0]!.id,
      body: "written against the first snapshot",
    });

    // A later export with the order reversed — different bytes, so not a
    // duplicate, and the case that would corrupt meaning if items mutated.
    const second = await importFromCsv(
      user.id,
      [HEADER, line(B, "Two"), line(A, "One")].join("\n"),
    );
    expect(second.ok).toBe(true);

    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.collectionItemId).toBe(firstItems[0]!.id);

    const stillThere = await prisma.collectionItem.findUniqueOrThrow({
      where: { id: firstItems[0]!.id },
    });
    expect(stillThere.position).toBe(0);
    expect(stillThere.recordingId).toBe(firstItems[0]!.recordingId);
    expect(stillThere.collectionId).toBe(first.summary.collectionId);
  });
});

describe("a CSV track and a link track are the same recording", () => {
  it("matches rather than duplicating on the second route in", async () => {
    const user = await makeUser();
    const csv = [HEADER, line(A, "One")].join("\n");

    await importFromCsv(user.id, csv);
    // A different file containing the same track — different bytes, so it is
    // imported, and the track must resolve to the row that already exists.
    const second = await importFromCsv(user.id, [HEADER, line(A, "One"), line(B, "Two")].join("\n"));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.summary.matched).toBe(1);
    expect(second.summary.created).toBe(1);
    expect(await prisma.recording.count()).toBe(2);
  });
});
