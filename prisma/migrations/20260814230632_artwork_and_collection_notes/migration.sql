-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "artwork_thumb_url" TEXT;

-- AlterTable
ALTER TABLE "collections" ADD COLUMN     "artwork_thumb_url" TEXT,
ADD COLUMN     "artwork_url" TEXT;

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "collection_id" UUID,
ALTER COLUMN "recording_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "artwork_thumb_url" TEXT;

-- CreateIndex
CREATE INDEX "notes_collection_id_idx" ON "notes"("collection_id");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A note is about EXACTLY ONE of a recording or a collection.
--
-- Prisma cannot express this, and without it making both columns nullable would
-- permit a note attached to nothing — which no query would return and no user
-- could ever reach or delete. The constraint is the whole reason it is safe to
-- relax `recording_id`.
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_exactly_one_subject"
  CHECK (num_nonnulls("recording_id", "collection_id") = 1);

-- Playlist context only makes sense for a note about a recording.
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_context_requires_recording"
  CHECK ("collection_item_id" IS NULL OR "recording_id" IS NOT NULL);
