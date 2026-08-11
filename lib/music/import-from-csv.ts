import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { importCollection, type ImportSummary } from "@/lib/music/import-collection";
import {
  CsvFormatError,
  parseExportifyCsv,
  toImportableCollection,
  type CsvRowError,
} from "@/lib/music/csv/exportify";
import { CsvTooLargeError } from "@/lib/music/csv/parse-csv";

/**
 * Importing a collection from a CSV the user exported themselves.
 *
 * Link import now covers albums and public playlists, so this is no longer the
 * main road — but it is the only road for the two cases that genuinely cannot
 * be read any other way: a **private** playlist, and Spotify's **own editorial**
 * playlists, which are withheld from Development Mode apps. Keeping it is what
 * stops those users from being told "no".
 *
 * Every import creates a new immutable snapshot. A repeated file is recognised
 * by content hash and **warned about rather than blocked**, because "I edited
 * one row and re-exported" and "I clicked twice" produce very different bytes
 * and only the user knows which happened.
 */

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

export type CsvImportOutcome =
  | { ok: true; summary: ImportSummary; skipped: CsvRowError[]; failed: CsvRowError[] }
  | {
      ok: false;
      reason: CsvImportRefusal;
      message: string;
      /** Present on "duplicate": what was previously imported from these bytes. */
      previous?: { collectionId: string | null; importedAt: Date };
      skipped?: CsvRowError[];
      failed?: CsvRowError[];
    };

export type CsvImportRefusal = "too-large" | "unreadable" | "empty" | "duplicate";

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function importFromCsv(
  ownerId: string,
  text: string,
  options: { filename?: string | null; name?: string; confirmDuplicate?: boolean } = {},
): Promise<CsvImportOutcome> {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message: `That file is over ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it and import the parts.`,
    };
  }

  const contentHash = hashContent(text);

  /**
   * Duplicate detection is owner-scoped: two people importing the same public
   * playlist export is not a duplicate, it is two people. Only a repeat by the
   * same person is worth mentioning.
   */
  if (!options.confirmDuplicate) {
    const previous = await prisma.import.findFirst({
      where: { ownerId, contentHash, status: "completed" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, collections: { select: { id: true }, take: 1 } },
    });

    if (previous) {
      return {
        ok: false,
        reason: "duplicate",
        message:
          "You have imported this exact file before. Importing it again creates a second, " +
          "separate snapshot — your existing collection and any notes on it are left alone.",
        previous: {
          collectionId: previous.collections[0]?.id ?? null,
          importedAt: previous.createdAt,
        },
      };
    }
  }

  let parsed;
  try {
    parsed = parseExportifyCsv(text);
  } catch (error) {
    if (error instanceof CsvTooLargeError || error instanceof CsvFormatError) {
      return { ok: false, reason: "unreadable", message: error.message };
    }
    throw error;
  }

  if (parsed.tracks.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message:
        parsed.failed.length + parsed.skipped.length > 0
          ? "No row in that file had a usable Spotify track URI, so there was nothing to import."
          : "That file had no track rows.",
      skipped: parsed.skipped,
      failed: parsed.failed,
    };
  }

  const name = (options.name ?? "").trim() || defaultName(options.filename);

  const summary = await importCollection(ownerId, toImportableCollection(name, parsed), {
    skippedCount: parsed.skipped.length,
    filename: options.filename ?? null,
    contentHash,
  });

  return { ok: true, summary, skipped: parsed.skipped, failed: parsed.failed };
}

/** Exportify names files after the playlist, so the filename is a good default. */
function defaultName(filename?: string | null): string {
  if (!filename) return "Imported collection";
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base || "Imported collection";
}
