-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('private', 'unlisted', 'public');

-- CreateEnum
CREATE TYPE "RecordingOrigin" AS ENUM ('provider', 'user');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('spotify', 'lastfm', 'musicbrainz', 'apple_music', 'youtube', 'bandcamp');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "username" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_external_ids" (
    "id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_url" TEXT,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "artist_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "primary_artist_id" UUID,
    "artist_display" TEXT,
    "release_date" DATE,
    "artwork_url" TEXT,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_external_ids" (
    "id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_url" TEXT,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "album_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "artist_display" TEXT NOT NULL,
    "origin" "RecordingOrigin" NOT NULL DEFAULT 'provider',
    "created_by_id" UUID,
    "normalized_key" TEXT NOT NULL,
    "duration_ms" INTEGER,
    "album_id" UUID,
    "release_title" TEXT,
    "release_date" DATE,
    "artwork_url" TEXT,
    "merged_into_id" UUID,
    "canonical_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_artists" (
    "recording_id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "credit_name" TEXT,

    CONSTRAINT "recording_artists_pkey" PRIMARY KEY ("recording_id","artist_id")
);

-- CreateTable
CREATE TABLE "recording_external_ids" (
    "id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_url" TEXT,
    "isrc" TEXT,
    "musicbrainz_recording_id" UUID,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "recording_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "collection_item_id" UUID,
    "body" TEXT NOT NULL,
    "display_title" TEXT,
    "display_artist" TEXT,
    "share_token" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'private',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'private',
    "share_token" TEXT,
    "source_provider" "Provider",
    "source_id" TEXT,
    "source_url" TEXT,
    "source_snapshot_at" TIMESTAMPTZ(6),
    "import_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "filename" TEXT,
    "content_hash" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "row_count" INTEGER,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_tags" (
    "note_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "note_tags_pkey" PRIMARY KEY ("note_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_subject_key" ON "users"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "artist_external_ids_artist_id_idx" ON "artist_external_ids"("artist_id");

-- CreateIndex
CREATE UNIQUE INDEX "artist_external_ids_provider_provider_id_key" ON "artist_external_ids"("provider", "provider_id");

-- CreateIndex
CREATE INDEX "albums_primary_artist_id_idx" ON "albums"("primary_artist_id");

-- CreateIndex
CREATE INDEX "album_external_ids_album_id_idx" ON "album_external_ids"("album_id");

-- CreateIndex
CREATE UNIQUE INDEX "album_external_ids_provider_provider_id_key" ON "album_external_ids"("provider", "provider_id");

-- CreateIndex
CREATE INDEX "recordings_normalized_key_idx" ON "recordings"("normalized_key");

-- CreateIndex
CREATE INDEX "recordings_album_id_idx" ON "recordings"("album_id");

-- CreateIndex
CREATE INDEX "recordings_origin_created_by_id_idx" ON "recordings"("origin", "created_by_id");

-- CreateIndex
CREATE INDEX "recordings_merged_into_id_idx" ON "recordings"("merged_into_id");

-- CreateIndex
CREATE INDEX "recording_artists_artist_id_idx" ON "recording_artists"("artist_id");

-- CreateIndex
CREATE UNIQUE INDEX "recording_artists_recording_id_position_key" ON "recording_artists"("recording_id", "position");

-- CreateIndex
CREATE INDEX "recording_external_ids_recording_id_idx" ON "recording_external_ids"("recording_id");

-- CreateIndex
CREATE INDEX "recording_external_ids_isrc_idx" ON "recording_external_ids"("isrc");

-- CreateIndex
CREATE UNIQUE INDEX "recording_external_ids_provider_provider_id_key" ON "recording_external_ids"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "notes_share_token_key" ON "notes"("share_token");

-- CreateIndex
CREATE INDEX "notes_owner_id_updated_at_idx" ON "notes"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "notes_recording_id_idx" ON "notes"("recording_id");

-- CreateIndex
CREATE INDEX "notes_collection_item_id_idx" ON "notes"("collection_item_id");

-- CreateIndex
CREATE INDEX "notes_visibility_published_at_idx" ON "notes"("visibility", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "collections_share_token_key" ON "collections"("share_token");

-- CreateIndex
CREATE INDEX "collections_owner_id_updated_at_idx" ON "collections"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "collections_import_id_idx" ON "collections"("import_id");

-- CreateIndex
CREATE INDEX "collection_items_collection_id_position_idx" ON "collection_items"("collection_id", "position");

-- CreateIndex
CREATE INDEX "collection_items_recording_id_idx" ON "collection_items"("recording_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_items_collection_id_position_key" ON "collection_items"("collection_id", "position");

-- CreateIndex
CREATE INDEX "imports_owner_id_created_at_idx" ON "imports"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "imports_owner_id_content_hash_idx" ON "imports"("owner_id", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tags_owner_id_name_key" ON "tags"("owner_id", "name");

-- CreateIndex
CREATE INDEX "note_tags_tag_id_idx" ON "note_tags"("tag_id");

-- AddForeignKey
ALTER TABLE "artist_external_ids" ADD CONSTRAINT "artist_external_ids_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_primary_artist_id_fkey" FOREIGN KEY ("primary_artist_id") REFERENCES "artists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_external_ids" ADD CONSTRAINT "album_external_ids_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_artists" ADD CONSTRAINT "recording_artists_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_artists" ADD CONSTRAINT "recording_artists_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_external_ids" ADD CONSTRAINT "recording_external_ids_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_collection_item_id_fkey" FOREIGN KEY ("collection_item_id") REFERENCES "collection_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
