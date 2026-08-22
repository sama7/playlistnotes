-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('day', 'month', 'year');

-- CreateEnum
CREATE TYPE "PlacePrecision" AS ENUM ('area', 'exact');

-- AlterTable
ALTER TABLE "collection_items" ADD COLUMN     "occurrence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "collections" ADD COLUMN     "refresh_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refreshed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "experienced_at" TIMESTAMPTZ(6),
ADD COLUMN     "experienced_precision" "DatePrecision",
ADD COLUMN     "place_label" TEXT,
ADD COLUMN     "place_lat" DECIMAL(9,6),
ADD COLUMN     "place_lon" DECIMAL(9,6),
ADD COLUMN     "place_precision" "PlacePrecision",
ADD COLUMN     "shared_in_collection" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "collection_items_collection_id_recording_id_occurrence_idx" ON "collection_items"("collection_id", "recording_id", "occurrence");

-- Backfill `occurrence` for collections that predate it. It is the nth
-- appearance of a recording within its collection, counting from 0 in position
-- order — exactly what a refresh re-anchors notes by, so it has to be right for
-- existing collections and not only for new ones.
UPDATE "collection_items" ci
SET "occurrence" = sub.rn
FROM (
  SELECT id,
         (ROW_NUMBER() OVER (PARTITION BY "collection_id", "recording_id"
                             ORDER BY "position")) - 1 AS rn
  FROM "collection_items"
) sub
WHERE ci.id = sub.id;

-- Coordinates belong only to a place the writer deliberately made exact. A
-- CHECK rather than a convention, because "we always set precision first" is
-- the kind of rule that survives until the second code path.
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_precise_place_is_opt_in"
  CHECK (
    ("place_lat" IS NULL AND "place_lon" IS NULL)
    OR ("place_precision" = 'exact' AND "place_lat" IS NOT NULL AND "place_lon" IS NOT NULL)
  );

-- A date with no stated precision, or a precision with no date, is not a
-- meaningful pair; store both or neither.
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_experienced_at_has_precision"
  CHECK (num_nonnulls("experienced_at", "experienced_precision") <> 1);

-- Existing thumbnails were captured at 64px, which is visibly blurry on a 3x
-- phone display. Provider URLs are opaque hashes and cannot be resized in
-- place, so the stored thumbs are cleared: rendering falls back to the
-- full-size URL, which is crisp, and the next resolution stores a 300px thumb.
UPDATE "recordings"  SET "artwork_thumb_url" = NULL;
UPDATE "albums"      SET "artwork_thumb_url" = NULL;
UPDATE "collections" SET "artwork_thumb_url" = NULL;
