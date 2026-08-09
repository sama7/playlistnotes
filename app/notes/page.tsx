import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CaptureForm } from "./capture-form";
import { NoteRow } from "./note-row";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const user = await requireUser();

  // Owner-scoped at the query, not filtered after the fact.
  const notes = await prisma.note.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { recording: { include: { externalIds: true } } },
    take: 100,
  });

  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3100";

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>Your notes</h1>
          <p className="lede">Private by default. Nothing is shared until you say so.</p>
        </div>
        <SignOutButton />
      </header>

      <CaptureForm />

      <h2>
        {notes.length === 0
          ? "Nothing yet"
          : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
      </h2>

      {notes.length === 0 ? (
        <p className="note">
          Paste a Spotify track link above and write the thing you want to remember about it.
        </p>
      ) : (
        <ul className="notes">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} baseUrl={baseUrl} />
          ))}
        </ul>
      )}

      <p className="note" style={{ marginTop: "2rem" }}>
        <Link href="/account">Account</Link>
      </p>
    </main>
  );
}
