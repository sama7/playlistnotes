import { prisma } from "@/lib/db";

/**
 * Checkpoint 1a — a local schema inspector, not a product surface.
 *
 * This exists so the data model can be judged by looking at it rather than by
 * reading `schema.prisma`. It renders exactly the cases the seed was built
 * around. It is replaced by the real application in Phase 2.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const [recordings, collections, notes] = await Promise.all([
    prisma.recording.findMany({
      orderBy: { title: "asc" },
      include: {
        artists: { orderBy: { position: "asc" }, include: { artist: true } },
        externalIds: true,
        album: true,
      },
    }),
    prisma.collection.findMany({
      orderBy: { sourceSnapshotAt: "asc" },
      include: {
        items: { orderBy: { position: "asc" }, include: { recording: true } },
        import: true,
      },
    }),
    prisma.note.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        owner: true,
        recording: true,
        collectionItem: { include: { collection: true } },
        tags: { include: { tag: true } },
      },
    }),
  ]);

  return (
    <main>
      <h1>Playlistnotes v2 — schema inspector</h1>
      <p className="lede">Local development only. Synthetic seed data.</p>

      <div className="banner">
        This page exists for <strong>Checkpoint 1a</strong>: judging the data model by
        looking at it. Every row below is seeded fiction. Nothing here is the real
        product — that starts in Phase 2.
      </div>

      <h2>Recordings</h2>
      <p className="note">
        Artists are linked from provider IDs, never by splitting the display string.
        A <code>user</code> origin means someone typed it in and it has no external
        identifier — it stays scoped to its creator.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>artist_display (raw)</th>
              <th>Linked artists (position)</th>
              <th>Origin</th>
              <th>External IDs</th>
            </tr>
          </thead>
          <tbody>
            {recordings.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>
                  <code>{r.artistDisplay}</code>
                </td>
                <td>
                  {r.artists.length === 0 ? (
                    <span className="note">none — display string only</span>
                  ) : (
                    r.artists
                      .map((ra) => `${ra.artist.name} (${ra.position})`)
                      .join(", ")
                  )}
                </td>
                <td>
                  <span className="pill">{r.origin}</span>
                </td>
                <td>
                  {r.externalIds.length === 0 ? (
                    <span className="note">none</span>
                  ) : (
                    r.externalIds
                      .map((e) => `${e.provider}${e.isrc ? ` · ${e.isrc}` : ""}`)
                      .join(", ")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Collections — immutable snapshots</h2>
      <p className="note">
        Two snapshots of the same logical playlist. A re-import creates a new one
        rather than reordering items underneath an existing note. Watch for the
        recording that appears twice in one snapshot.
      </p>
      {collections.map((c) => (
        <div key={c.id} style={{ marginTop: "1.25rem" }}>
          <strong>{c.name}</strong>{" "}
          <span className="pill">{c.visibility}</span>{" "}
          <span className="note">
            snapshot {c.sourceSnapshotAt?.toISOString().slice(0, 10) ?? "—"}
            {c.import ? ` · ${c.import.filename}` : ""}
          </span>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Recording</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.position}</td>
                    <td>{item.recording.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <h2>Notes</h2>
      <p className="note">
        Two users hold private notes on the same shared recording. The display
        override lives on the note, so one user&rsquo;s correction can never change
        what the other saved, and it never mutates the shared recording row.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Owner</th>
              <th>Recording</th>
              <th>Display override</th>
              <th>Playlist context</th>
              <th>Visibility</th>
              <th>Body</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id}>
                <td>{n.owner.displayName ?? n.owner.username}</td>
                <td>{n.recording.title}</td>
                <td>
                  {n.displayTitle || n.displayArtist ? (
                    <code>
                      {n.displayTitle ?? n.recording.title} —{" "}
                      {n.displayArtist ?? n.recording.artistDisplay}
                    </code>
                  ) : (
                    <span className="note">—</span>
                  )}
                </td>
                <td>
                  {n.collectionItem ? (
                    `${n.collectionItem.collection.name} @ ${n.collectionItem.position}`
                  ) : (
                    <span className="note">—</span>
                  )}
                </td>
                <td>
                  <span className="pill">{n.visibility}</span>
                </td>
                <td>
                  {n.body}
                  {n.tags.length > 0 && (
                    <div className="note">
                      tags: {n.tags.map((t) => t.tag.name).join(", ")}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
