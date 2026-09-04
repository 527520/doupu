-- Safe additive index rollback. Existing analytics rows are unaffected.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP INDEX IF EXISTS "analytics_events_time_idx";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788552433815;
COMMIT;
