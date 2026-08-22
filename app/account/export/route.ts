import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { collectExport, toCsv, toJson, toMarkdown } from "@/lib/notes/export";

export const dynamic = "force-dynamic";

/**
 * Download everything you have written.
 *
 * A route handler rather than a Server Action, because the result is a *file*:
 * the browser needs a real response with `Content-Disposition`, and an action
 * would have to marshal the whole export through the RSC payload to hand it back
 * to JavaScript that then fakes a download.
 *
 * `requireUser()` is the only authorisation, and it is enough precisely because
 * the query is scoped to the id it returns. There is no user parameter to
 * tamper with — the one thing v1 got wrong, in the one place it would hurt most.
 */
const FORMATS = {
  json: { render: toJson, type: "application/json; charset=utf-8", ext: "json" },
  csv: { render: toCsv, type: "text/csv; charset=utf-8", ext: "csv" },
  md: { render: toMarkdown, type: "text/markdown; charset=utf-8", ext: "md" },
} as const;

export async function GET(request: Request) {
  const user = await requireUser();

  const requested = new URL(request.url).searchParams.get("format") ?? "json";
  const format = requested in FORMATS ? (requested as keyof typeof FORMATS) : "json";
  const { render, type, ext } = FORMATS[format];

  const notes = await collectExport(user.id);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(render(notes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="trackjot-notes-${stamp}.${ext}"`,
      // An export is the single largest disclosure this product performs; it
      // must never sit in a shared cache or a browser's back-forward store.
      "Cache-Control": "no-store, private",
    },
  });
}
