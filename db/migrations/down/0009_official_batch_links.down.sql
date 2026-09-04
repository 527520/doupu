-- Safe only before official batch drafts exist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP INDEX IF EXISTS "community_revisions_official_batch_idx";
ALTER TABLE "community_revisions" DROP COLUMN IF EXISTS "official_batch_id";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788544484216;
COMMIT;
