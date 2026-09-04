-- Safe only before moderation rule versions have been changed in production.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DELETE FROM "moderation_rule_set_versions"
WHERE "id" = 'f0c81a4d-a5d8-4d6a-97e4-e42dc8ca9cc8'
  AND "version" = 1
  AND "reason" = '豆谱内置初始治理词表';
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788552854206;
COMMIT;
