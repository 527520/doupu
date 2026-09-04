-- Safe only before community data exists. After writes, roll back the
-- application and retain these additive tables and columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "designs" DROP CONSTRAINT IF EXISTS "designs_community_source_work_id_community_works_id_fk";
ALTER TABLE "designs" DROP COLUMN IF EXISTS "community_source_revision_id";
ALTER TABLE "designs" DROP COLUMN IF EXISTS "community_source_work_id";
DROP TABLE IF EXISTS "community_revision_tags";
DROP TABLE IF EXISTS "community_revisions";
DROP TABLE IF EXISTS "community_tags";
DROP TABLE IF EXISTS "official_batches";
DROP TABLE IF EXISTS "community_works";
DROP TYPE IF EXISTS "official_batch_status";
DROP TYPE IF EXISTS "community_revision_status";
DROP TYPE IF EXISTS "community_work_status";
DROP TYPE IF EXISTS "community_author_type";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788542682699;
COMMIT;
