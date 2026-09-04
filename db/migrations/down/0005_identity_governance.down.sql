-- Safe only before identity-governance data exists. After writes, roll back the
-- application and retain these additive columns/tables instead of running this.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP INDEX IF EXISTS "users_public_author_unique";
DROP TABLE IF EXISTS "maintenance_runs";
DROP TABLE IF EXISTS "admin_audit_logs";
ALTER TABLE "users" DROP COLUMN IF EXISTS "anonymized_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "suspended_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "status_changed_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "account_status_reason";
ALTER TABLE "users" DROP COLUMN IF EXISTS "public_author_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "governance_version";
ALTER TABLE "users" DROP COLUMN IF EXISTS "account_status";
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL;
DROP TYPE IF EXISTS "maintenance_status";
DROP TYPE IF EXISTS "account_status";
DROP TYPE IF EXISTS "user_role";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788534913875;
COMMIT;
