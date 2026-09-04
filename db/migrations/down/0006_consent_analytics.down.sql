-- Safe only before analytics data exists. After writes, roll back the
-- application and retain these additive tables instead of running this.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TABLE IF EXISTS "analytics_events";
DROP TABLE IF EXISTS "analytics_identity_links";
DROP TABLE IF EXISTS "analytics_visitors";
DROP TABLE IF EXISTS "analytics_daily_rollups";
DROP TABLE IF EXISTS "analytics_deletion_requests";
DROP TYPE IF EXISTS "analytics_os";
DROP TYPE IF EXISTS "analytics_device";
DROP TYPE IF EXISTS "analytics_deletion_status";
DROP TYPE IF EXISTS "analytics_browser";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788537353112;
COMMIT;
