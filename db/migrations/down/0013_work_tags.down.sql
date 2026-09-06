-- Safe only before moderators have tagged works through the new work-level table.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TABLE IF EXISTS "community_work_tags";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788671336734;
COMMIT;
