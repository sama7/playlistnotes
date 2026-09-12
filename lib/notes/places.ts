import { prisma } from "@/lib/db";

/**
 * The places this person has already written about.
 *
 * ## Why a query and not a service
 *
 * "Where you were" was a free-text box next to a checkbox that promised
 * coordinates it never captured. The box was right; the checkbox was not. What
 * makes a place worth typing is being able to *find it again* — and that needs
 * nothing more than the labels this user has already used.
 *
 * So there is no geocoder, no global places table, and no third party. A place
 * is closer to a tag than to a coordinate: the writer's own vocabulary for
 * where their life happened. "Dad's kitchen" and "on the train" are perfectly
 * good places and no gazetteer contains either.
 *
 * **Owner-scoped in the WHERE clause**, like every other query here. One
 * person's places are not a shared dictionary, and suggesting them across
 * accounts would leak where people have been — which is exactly the liability
 * the coarse-by-default rule existed to avoid.
 */
export interface PlaceCount {
  label: string;
  count: number;
}

export async function listPlaces(ownerId: string, limit = 200): Promise<PlaceCount[]> {
  const rows = await prisma.note.groupBy({
    by: ["placeLabel"],
    where: { ownerId, placeLabel: { not: null } },
    _count: { placeLabel: true },
    orderBy: { _count: { placeLabel: "desc" } },
    take: Math.min(Math.max(limit, 1), 500),
  });

  return rows
    .filter((r): r is typeof r & { placeLabel: string } => Boolean(r.placeLabel))
    .map((r) => ({ label: r.placeLabel, count: r._count.placeLabel }));
}
