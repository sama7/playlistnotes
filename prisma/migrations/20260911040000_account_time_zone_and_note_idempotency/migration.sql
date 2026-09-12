-- The zone an account reads and writes times in. Null means "never chosen",
-- which the application resolves to the product default rather than to UTC:
-- every existing note was written when that default was the only behaviour.
ALTER TABLE "users" ADD COLUMN "time_zone" TEXT;

-- Makes a retried jot idempotent. Null is exempt from a UNIQUE constraint in
-- PostgreSQL, so every note written before this column existed — and every note
-- written by a path that does not need deduplication — coexists freely.
ALTER TABLE "notes" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "notes_owner_id_idempotency_key_key"
  ON "notes"("owner_id", "idempotency_key");
