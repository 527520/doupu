-- Safe only before official batch drafts exist.
DROP INDEX IF EXISTS "community_revisions_official_batch_idx";
ALTER TABLE "community_revisions" DROP COLUMN IF EXISTS "official_batch_id";
