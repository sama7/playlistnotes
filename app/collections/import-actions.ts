"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { MAX_CSV_BYTES, importFromCsv } from "@/lib/music/import-from-csv";

/**
 * Uploading a CSV export as a collection.
 *
 * The file is read into memory and never written to disk. It contains a
 * person's listening, so the fewer places it exists the better — and the size
 * cap is checked before reading rather than after, so a large upload cannot be
 * used to exhaust a 2 GB box.
 */

export interface CsvImportState {
  error?: string;
  /** Set when the same bytes were imported before; the user chooses. */
  duplicate?: { collectionId: string | null; importedAt: string };
  imported?: {
    collectionId: string;
    name: string;
    count: number;
    created: number;
    matched: number;
    skipped: number;
  };
  /** A few example rows that were not imported, so the report is checkable. */
  problems?: Array<{ line: number; reason: string }>;
}

export async function importCsvAction(
  _previous: CsvImportState,
  formData: FormData,
): Promise<CsvImportState> {
  const user = await requireUser();

  const file = formData.get("file");
  const name = String(formData.get("name") ?? "").trim();
  const confirmDuplicate = formData.get("confirmDuplicate") === "yes";

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return {
      error: `That file is over ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it and import the parts.`,
    };
  }

  const text = await file.text();

  const result = await importFromCsv(user.id, text, {
    filename: file.name,
    name,
    confirmDuplicate,
  });

  if (!result.ok) {
    if (result.reason === "duplicate") {
      return {
        error: result.message,
        duplicate: {
          collectionId: result.previous?.collectionId ?? null,
          importedAt: (result.previous?.importedAt ?? new Date()).toISOString().slice(0, 10),
        },
      };
    }
    return {
      error: result.message,
      problems: [...(result.failed ?? []), ...(result.skipped ?? [])].slice(0, 5),
    };
  }

  revalidatePath("/collections");
  return {
    imported: {
      collectionId: result.summary.collectionId,
      name: result.summary.name,
      count: result.summary.imported,
      created: result.summary.created,
      matched: result.summary.matched,
      skipped: result.summary.skipped,
    },
    problems: [...result.failed, ...result.skipped].slice(0, 5),
  };
}
