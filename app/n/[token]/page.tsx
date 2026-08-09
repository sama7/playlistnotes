import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSharedNote } from "@/lib/notes/service";

export const dynamic = "force-dynamic";

/**
 * A deliberately shared note, readable without signing in.
 *
 * Unlisted pages are addressable but must never be discoverable, so this sets
 * `noindex` regardless of the global setting. Nothing here reveals the note's
 * UUID, its owner's identity, or anything the owner did not publish.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharedNotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Visibility is re-checked in the query, so un-publishing genuinely revokes
  // access rather than merely hiding the link.
  const note = await getSharedNote(token);
  if (!note) notFound();

  const recording = await prisma.recording.findUniqueOrThrow({
    where: { id: note.recordingId },
    include: { externalIds: true },
  });

  const title = note.displayTitle ?? recording.title;
  const artist = note.displayArtist ?? recording.artistDisplay;
  const spotify = recording.externalIds.find((e) => e.provider === "spotify");

  return (
    <main>
      <p className="eyebrow">Shared from Playlistnotes</p>
      <h1>{title}</h1>
      <p className="lede">{artist}</p>

      <blockquote className="shared-note">{note.body}</blockquote>

      {spotify?.providerUrl && (
        <p>
          <a href={spotify.providerUrl} target="_blank" rel="noopener noreferrer">
            Open in Spotify
          </a>
        </p>
      )}

      <p className="note" style={{ marginTop: "2rem" }}>
        This is one note someone chose to share. Their other notes are private.
      </p>
    </main>
  );
}
