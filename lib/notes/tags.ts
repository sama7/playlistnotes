import { prisma } from "@/lib/db";
import { NoteNotFoundError } from "@/lib/notes/service";

/**
 * Tags, scoped to the person who wrote them.
 *
 * The unique constraint is `(owner_id, name)`, not `name`, and that is the whole
 * design. A shared tag vocabulary would make one user's labels visible to
 * another the moment autocomplete existed, and "chill" meaning one thing to you
 * and another to someone else is not a conflict worth resolving — it is two
 * private filing systems that happen to use the same word.
 *
 * Tags are therefore free text, normalised only for matching, and never
 * promoted into anything shared. That is the same rule the catalog policy
 * applies to user-authored recordings (AGENTS.md §3a.5), for the same reason.
 */

const MAX_TAGS_PER_NOTE = 12;
const MAX_TAG_LENGTH = 40;

/**
 * Fold case and collapse whitespace so "Late Night" and "late  night" are one
 * tag, while leaving everything else alone — stripping punctuation would merge
 * tags a user deliberately distinguished.
 */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
}

/** Split what a user typed into distinct tag names, in the order given. */
export function parseTagInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const name = normalizeTagName(piece);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_TAGS_PER_NOTE) break;
  }
  return out;
}

/**
 * Replace a note's tags with exactly this set.
 *
 * Replace rather than merge: the input is the full contents of a text field, so
 * a name the user removed from it must actually go away. Everything runs in one
 * transaction so a note is never briefly untagged.
 */
export async function setNoteTags(
  ownerId: string,
  noteId: string,
  names: string[],
): Promise<string[]> {
  const wanted = parseTagInput(names.join(","));

  return prisma.$transaction(async (tx) => {
    // Owner-scoped: a valid note id belonging to someone else resolves to
    // nothing and is reported as missing, exactly like a deleted note.
    const note = await tx.note.findFirst({ where: { id: noteId, ownerId }, select: { id: true } });
    if (!note) throw new NoteNotFoundError();

    const tagIds: string[] = [];
    for (const name of wanted) {
      const tag = await tx.tag.upsert({
        where: { ownerId_name: { ownerId, name } },
        create: { ownerId, name },
        update: {},
        select: { id: true },
      });
      tagIds.push(tag.id);
    }

    await tx.noteTag.deleteMany({ where: { noteId, tagId: { notIn: tagIds } } });
    if (tagIds.length > 0) {
      await tx.noteTag.createMany({
        data: tagIds.map((tagId) => ({ noteId, tagId })),
        skipDuplicates: true,
      });
    }

    /**
     * Drop tags this user no longer uses anywhere. Without this the tag list
     * only ever grows, and a filter menu full of labels attached to nothing is
     * worse than no menu. Scoped to this owner, so it cannot touch anyone else's.
     */
    await tx.tag.deleteMany({ where: { ownerId, notes: { none: {} } } });

    return wanted;
  });
}

export async function listTags(ownerId: string): Promise<Array<{ name: string; count: number }>> {
  const tags = await prisma.tag.findMany({
    where: { ownerId },
    select: { name: true, _count: { select: { notes: true } } },
    orderBy: { name: "asc" },
  });
  return tags.map((t) => ({ name: t.name, count: t._count.notes }));
}

/** Notes carrying a given tag, owner-scoped at both ends. */
export async function notesByTag(ownerId: string, tagName: string) {
  const name = normalizeTagName(tagName);
  if (!name) return [];

  return prisma.note.findMany({
    where: { ownerId, tags: { some: { tag: { ownerId, name } } } },
    orderBy: { updatedAt: "desc" },
    include: { recording: { include: { externalIds: true } } },
    take: 100,
  });
}
