SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'anonymized');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"request_id" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"status" "maintenance_status" DEFAULT 'running' NOT NULL,
	"cursor" text,
	"summary" jsonb,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" "account_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "governance_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_author_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "maintenance_runs_task_started_idx" ON "maintenance_runs" USING btree ("task","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_public_author_unique" ON "users" USING btree ("public_author_id") WHERE "users"."public_author_id" is not null;
