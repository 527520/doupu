-- Only use before new comment publication timestamps have been stored.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "community_comments" DROP COLUMN "published_at";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788567595246;
COMMIT;
