-- Safe only before governance data exists. After writes, roll back the
-- application and retain these additive tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TABLE IF EXISTS "moderation_rule_set_versions";
DROP TABLE IF EXISTS "idempotency_records";
DROP TABLE IF EXISTS "community_reuses";
DROP TABLE IF EXISTS "community_reports";
DROP TABLE IF EXISTS "community_comments";
DROP TABLE IF EXISTS "community_likes";
DROP TYPE IF EXISTS "community_report_target";
DROP TYPE IF EXISTS "community_report_status";
DROP TYPE IF EXISTS "community_comment_status";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788543666201;
COMMIT;
