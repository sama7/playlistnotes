-- CreateEnum
CREATE TYPE "ListenSource" AS ENUM ('lastfm');

-- AlterEnum
ALTER TYPE "DatePrecision" ADD VALUE 'time';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastfm_linked_at" TIMESTAMPTZ(6),
ADD COLUMN     "lastfm_prompt_dismissed_at" TIMESTAMPTZ(6),
ADD COLUMN     "lastfm_username" TEXT;

-- CreateTable
CREATE TABLE "listens" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "source" "ListenSource" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "source_url" TEXT,
    "played_at" TIMESTAMPTZ(6) NOT NULL,
    "track_name" TEXT NOT NULL,
    "artist_name" TEXT NOT NULL,
    "album_name" TEXT,
    "recording_mbid" TEXT,
    "artist_mbid" TEXT,
    "album_mbid" TEXT,
    "recording_id" UUID,
    "imported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listens_owner_id_played_at_idx" ON "listens"("owner_id", "played_at" DESC);

-- CreateIndex
CREATE INDEX "listens_recording_id_idx" ON "listens"("recording_id");

-- CreateIndex
CREATE UNIQUE INDEX "listens_owner_id_source_source_ref_key" ON "listens"("owner_id", "source", "source_ref");

-- AddForeignKey
ALTER TABLE "listens" ADD CONSTRAINT "listens_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listens" ADD CONSTRAINT "listens_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A listen that has been imported must say which recording it became, and one
-- that has not must not pretend to. A CHECK rather than a convention, because
-- "we always set both together" survives exactly until the second code path.
ALTER TABLE "listens"
  ADD CONSTRAINT "listens_imported_has_recording"
  CHECK (num_nonnulls("recording_id", "imported_at") <> 1);
