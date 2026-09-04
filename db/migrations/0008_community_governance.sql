SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TYPE "public"."community_comment_status" AS ENUM('pending_review', 'published', 'hidden', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."community_report_status" AS ENUM('open', 'accepted', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."community_report_target" AS ENUM('work', 'comment');--> statement-breakpoint
CREATE TABLE "community_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"author_user_id" uuid,
	"public_author_id" text NOT NULL,
	"frozen_display_name" text NOT NULL,
	"status" "community_comment_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"risk_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by_user_id" uuid,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "community_report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"target_version" integer NOT NULL,
	"reporter_user_id" uuid,
	"category" text NOT NULL,
	"details" text,
	"status" "community_report_status" DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"handled_by_user_id" uuid,
	"handling_reason" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_reuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"user_id" uuid,
	"design_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_rule_set_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_rule_set_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reuses" ADD CONSTRAINT "community_reuses_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reuses" ADD CONSTRAINT "community_reuses_revision_id_community_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."community_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reuses" ADD CONSTRAINT "community_reuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reuses" ADD CONSTRAINT "community_reuses_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_rule_set_versions" ADD CONSTRAINT "moderation_rule_set_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_comments_work_status_idx" ON "community_comments" USING btree ("work_id","status","created_at");--> statement-breakpoint
CREATE INDEX "community_comments_review_queue_idx" ON "community_comments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "community_comments_author_recent_idx" ON "community_comments" USING btree ("author_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "community_likes_work_user_unique" ON "community_likes" USING btree ("work_id","user_id");--> statement-breakpoint
CREATE INDEX "community_likes_user_idx" ON "community_likes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_reporter_target_version_unique" ON "community_reports" USING btree ("reporter_user_id","target_type","target_id","target_version");--> statement-breakpoint
CREATE INDEX "community_reports_status_created_idx" ON "community_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "community_reuses_work_idx" ON "community_reuses" USING btree ("work_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "community_reuses_user_idx" ON "community_reuses" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_actor_scope_key_unique" ON "idempotency_records" USING btree ("actor_user_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_rule_set_single_active" ON "moderation_rule_set_versions" USING btree ("active") WHERE "moderation_rule_set_versions"."active" = true;
