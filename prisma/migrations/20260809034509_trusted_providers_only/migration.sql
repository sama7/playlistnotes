-- AlterEnum
BEGIN;
CREATE TYPE "Provider_new" AS ENUM ('spotify', 'apple_music', 'deezer', 'tidal', 'musicbrainz', 'discogs');
ALTER TABLE "artist_external_ids" ALTER COLUMN "provider" TYPE "Provider_new" USING ("provider"::text::"Provider_new");
ALTER TABLE "album_external_ids" ALTER COLUMN "provider" TYPE "Provider_new" USING ("provider"::text::"Provider_new");
ALTER TABLE "recording_external_ids" ALTER COLUMN "provider" TYPE "Provider_new" USING ("provider"::text::"Provider_new");
ALTER TABLE "collections" ALTER COLUMN "source_provider" TYPE "Provider_new" USING ("source_provider"::text::"Provider_new");
ALTER TABLE "imports" ALTER COLUMN "provider" TYPE "Provider_new" USING ("provider"::text::"Provider_new");
ALTER TYPE "Provider" RENAME TO "Provider_old";
ALTER TYPE "Provider_new" RENAME TO "Provider";
DROP TYPE "public"."Provider_old";
COMMIT;

