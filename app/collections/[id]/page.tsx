import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);

  // Owner-scoped in the query: a valid id belonging to someone else is a 404,
  // indistinguishable from one that never existed.
  const collection = await prisma.collection.findFirst({
    where: { id, ownerId: user.id },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: {
          recording: {
            include: {
              artists: { orderBy: { position: "asc" }, include: { artist: true } },
              externalIds: true,
            },
          },
          notes: { where: { ownerId: user.id } },
        },
      },
    },
  });

  if (!collection) notFound();

  return (
    <main>
      <p className="eyebrow">Collection snapshot</p>
      <h1>{collection.name}</h1>
      <p className="lede">
        {collection.items.length} track{collection.items.length === 1 ? "" : "s"}
        {collection.sourceSnapshotAt
          ? ` · imported ${collection.sourceSnapshotAt.toISOString().slice(0, 10)}`
          : ""}
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Track</th>
              <th>Artists</th>
              <th>Your note</th>
            </tr>
          </thead>
          <tbody>
            {collection.items.map((item) => {
              const spotify = item.recording.externalIds.find((e) => e.provider === "spotify");
              return (
                <tr key={item.id}>
                  <td className="note">{item.position + 1}</td>
                  <td>
                    {spotify?.providerUrl ? (
                      <a href={spotify.providerUrl} target="_blank" rel="noopener noreferrer">
                        {item.recording.title}
                      </a>
                    ) : (
                      item.recording.title
                    )}
                  </td>
                  <td>
                    {/* Linked entities where we have them, the raw display
                        string where we do not. */}
                    {item.recording.artists.length > 0
                      ? item.recording.artists.map((ra) => ra.artist.name).join(", ")
                      : item.recording.artistDisplay}
                  </td>
                  <td>
                    {item.notes.length > 0 ? (
                      item.notes[0]!.body
                    ) : (
                      <span className="note">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="note" style={{ marginTop: "1.5rem" }}>
        <Link href="/collections">All collections</Link> · <Link href="/notes">Notes</Link>
      </p>
    </main>
  );
}
