"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  MAX_CSV_BYTES,
  importCsvIntoCollection,
  importFromCsv,
} from "@/lib/music/import-from-csv";
import type { ReconcileMode } from "@/lib/collections/reconcile";

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
  /** Set when importing INTO a collection: what would change, before it does. */
  preview?: {
    collectionId: string;
    name: string;
    mode: ReconcileMode;
    added: number;
    removed: number;
    moved: number;
    total: number;
    orphaning: Array<{ id: string; body: string; trackTitle: string }>;
  };
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

  /**
   * Where the rows go. An empty target means "a new collection", which is the
   * behaviour this form has always had and the right default for a first
   * import. Choosing an existing collection turns this into the same operation
   * as a refresh, and takes the same two steps: preview, then confirm.
   */
  const targetId = String(formData.get("targetCollectionId") ?? "").trim();
  const mode: ReconcileMode = formData.get("mode") === "append" ? "append" : "replace";
  const applyToTarget = formData.get("confirmTarget") === "yes";

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return {
      error: `That file is over ${MAX_CSV_BYTES / 1024 / 1024} MB. Split it and import the parts.`,
    };
  }

  const text = await file.text();

  if (targetId) {
    const into = await importCsvIntoCollection(user.id, targetId, text, mode, {
      filename: file.name,
      name,
      apply: applyToTarget,
    });

    if (!into.ok) return { error: into.message };

    if (!into.applied) {
      return {
        preview: {
          collectionId: into.preview.collectionId,
          name: into.preview.name,
          mode,
          added: into.preview.added,
          removed: into.preview.removed,
          moved: into.preview.moved,
          total: into.preview.total,
          orphaning: into.preview.orphaning,
        },
      };
    }

    revalidatePath(`/collections/${into.preview.collectionId}`);
    revalidatePath("/notes");
    return {
      imported: {
        collectionId: into.preview.collectionId,
        name: into.preview.name,
        count: into.preview.total,
        created: into.preview.added,
        matched: into.preview.unchanged + into.preview.moved,
        skipped: into.skipped.length,
      },
    };
  }

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
