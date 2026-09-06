-- Safe only before any work original has been uploaded; COS objects must be removed separately.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TABLE IF EXISTS "community_originals";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788676406284;
COMMIT;
