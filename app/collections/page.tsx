import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CsvImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const user = await requireUser();

  const collections = await prisma.collection.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } }, import: true },
  });

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>Your collections</h1>
          <p className="lede">
            Each import is a snapshot. Re-importing makes a new one rather than rewriting the old.
          </p>
        </div>
        <Link href="/notes">Notes</Link>
      </header>

      <CsvImportForm />

      {collections.length === 0 ? (
        <p className="note" style={{ marginTop: "1.5rem" }}>
          Nothing yet. Paste a Spotify or Apple Music album or playlist link on the{" "}
          <Link href="/notes">notes page</Link> and the whole thing comes across — or
          import a CSV above.
        </p>
      ) : (
        <ul className="notes" style={{ marginTop: "1.5rem" }}>
          {collections.map((c) => (
            <li key={c.id} className="note-card">
              <div className="note-head">
                <div>
                  <strong>
                    <Link href={`/collections/${c.id}`}>{c.name}</Link>
                  </strong>
                  <div className="note">
                    {c._count.items} track{c._count.items === 1 ? "" : "s"}
                    {c.sourceSnapshotAt
                      ? ` · imported ${c.sourceSnapshotAt.toISOString().slice(0, 10)}`
                      : ""}
                  </div>
                </div>
                <span className={`chip ${c.visibility}`}>{c.visibility}</span>
              </div>
              {c.description && <p className="note">{c.description}</p>}
              {c.sourceUrl && (
                <p className="note">
                  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Open the original
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
