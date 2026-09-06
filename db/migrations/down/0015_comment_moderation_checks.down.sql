-- Safe only before any comment has been rejected by the content-safety service.
-- PostgreSQL cannot drop a single enum value; 'rejected' stays in the type and is simply unused.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TABLE IF EXISTS "comment_moderation_checks";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788682032323;
COMMIT;
