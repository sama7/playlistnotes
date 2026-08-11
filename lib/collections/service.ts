import { randomBytes } from "node:crypto";
import { Visibility, type Collection } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Publishing a collection — and the invariant that makes it safe.
 *
 * **Publishing a collection never publishes the notes inside it.** The two
 * visibilities are independent columns on independent rows, and a shared
 * collection is read through `getSharedCollection`, which selects the
 * tracklist and deliberately does not touch the `notes` relation at all.
 *
 * That is the design decision worth being explicit about: the safety does not
 * come from filtering notes out of the shared view. It comes from the shared
 * view never asking for them. A filter is a thing you can forget to apply to a
 * new query; not having the data in the shape at all is not.
 *
 * If per-note publication inside a shared collection is ever wanted, it should
 * be an explicit second query for notes whose own visibility permits it —
 * added deliberately, with its own tests, not by relaxing this one.
 */

export class CollectionNotFoundError extends Error {
  constructor() {
    super("Collection not found");
    this.name = "CollectionNotFoundError";
  }
}

/** 32 bytes of entropy, url-safe. The URL exposes this, never the UUID. */
function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function getCollection(
  ownerId: string,
  collectionId: string,
): Promise<Collection | null> {
  return prisma.collection.findFirst({ where: { id: collectionId, ownerId } });
}

export async function publishCollectionUnlisted(
  ownerId: string,
  collectionId: string,
): Promise<Collection> {
  const existing = await getCollection(ownerId, collectionId);
  if (!existing) throw new CollectionNotFoundError();

  return prisma.collection.update({
    where: { id: existing.id },
    data: {
      visibility: Visibility.unlisted,
      shareToken: existing.shareToken ?? newShareToken(),
    },
  });
}

export async function rotateCollectionShareToken(
  ownerId: string,
  collectionId: string,
): Promise<Collection> {
  const existing = await getCollection(ownerId, collectionId);
  if (!existing) throw new CollectionNotFoundError();
  return prisma.collection.update({
    where: { id: existing.id },
    data: { shareToken: newShareToken() },
  });
}

export async function unpublishCollection(
  ownerId: string,
  collectionId: string,
): Promise<Collection> {
  const existing = await getCollection(ownerId, collectionId);
  if (!existing) throw new CollectionNotFoundError();
  return prisma.collection.update({
    where: { id: existing.id },
    // Clearing the token matters: un-publishing must revoke the old link, not
    // merely stop advertising it.
    data: { visibility: Visibility.private, shareToken: null },
  });
}

/** Exactly the fields an anonymous viewer is allowed to see. */
export interface SharedCollection {
  name: string;
  description: string | null;
  sourceUrl: string | null;
  snapshotAt: Date | null;
  tracks: Array<{
    position: number;
    title: string;
    artistDisplay: string;
    providerUrl: string | null;
  }>;
}

/**
 * Read a collection by share token, for anonymous viewers.
 *
 * The select list is explicit and narrow by intent. `notes` is absent, so no
 * private note can be reached through this path; owner ids, internal UUIDs,
 * import records and provider metadata are absent for the same reason —
 * whatever is not selected cannot leak.
 */
export async function getSharedCollection(shareToken: string): Promise<SharedCollection | null> {
  const collection = await prisma.collection.findFirst({
    where: {
      shareToken,
      visibility: { in: [Visibility.unlisted, Visibility.public] },
    },
    select: {
      name: true,
      description: true,
      sourceUrl: true,
      sourceSnapshotAt: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          recording: {
            select: {
              title: true,
              artistDisplay: true,
              artists: {
                orderBy: { position: "asc" },
                select: { artist: { select: { name: true } } },
              },
              externalIds: { select: { providerUrl: true }, take: 1 },
            },
          },
        },
      },
    },
  });

  if (!collection) return null;

  return {
    name: collection.name,
    description: collection.description,
    sourceUrl: collection.sourceUrl,
    snapshotAt: collection.sourceSnapshotAt,
    tracks: collection.items.map((item) => ({
      position: item.position,
      title: item.recording.title,
      artistDisplay:
        item.recording.artists.length > 0
          ? item.recording.artists.map((ra) => ra.artist.name).join(", ")
          : item.recording.artistDisplay,
      providerUrl: item.recording.externalIds[0]?.providerUrl ?? null,
    })),
  };
}
