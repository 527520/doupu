SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TYPE "public"."community_author_type" AS ENUM('user', 'official');--> statement-breakpoint
CREATE TYPE "public"."community_revision_status" AS ENUM('draft', 'pending_review', 'published', 'rejected', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."community_work_status" AS ENUM('active', 'withdrawn', 'removed');--> statement-breakpoint
CREATE TYPE "public"."official_batch_status" AS ENUM('draft', 'running', 'paused', 'cancelled', 'completed');--> statement-breakpoint
CREATE TABLE "community_revision_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "community_revision_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"author_type" "community_author_type" NOT NULL,
	"public_author_id" text NOT NULL,
	"frozen_display_name" text NOT NULL,
	"source_design_id" uuid,
	"license_version" text NOT NULL,
	"license_confirmed_at" timestamp with time zone NOT NULL,
	"engine_version" text NOT NULL,
	"board_profile" text NOT NULL,
	"palette_kind" text NOT NULL,
	"palette_id" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"color_count" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"review_reason" text,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"merged_into_tag_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" uuid,
	"author_type" "community_author_type" DEFAULT 'user' NOT NULL,
	"lifecycle_status" "community_work_status" DEFAULT 'active' NOT NULL,
	"current_published_revision_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"comments_locked" boolean DEFAULT false NOT NULL,
	"featured_at" timestamp with time zone,
	"featured_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "official_batch_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"default_params" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"admin_user_id" uuid,
	"item_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "community_source_work_id" uuid;--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "community_source_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "community_revision_tags" ADD CONSTRAINT "community_revision_tags_revision_id_community_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."community_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_revision_tags" ADD CONSTRAINT "community_revision_tags_tag_id_community_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."community_tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_revisions" ADD CONSTRAINT "community_revisions_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_revisions" ADD CONSTRAINT "community_revisions_source_design_id_designs_id_fk" FOREIGN KEY ("source_design_id") REFERENCES "public"."designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_revisions" ADD CONSTRAINT "community_revisions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_works" ADD CONSTRAINT "community_works_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_works" ADD CONSTRAINT "community_works_featured_by_user_id_users_id_fk" FOREIGN KEY ("featured_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_batches" ADD CONSTRAINT "official_batches_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_revision_tags_unique" ON "community_revision_tags" USING btree ("revision_id","tag_id");--> statement-breakpoint
CREATE INDEX "community_revision_tags_tag_idx" ON "community_revision_tags" USING btree ("tag_id","revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_revisions_work_number_unique" ON "community_revisions" USING btree ("work_id","revision_number");--> statement-breakpoint
CREATE INDEX "community_revisions_work_status_idx" ON "community_revisions" USING btree ("work_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "community_revisions_review_queue_idx" ON "community_revisions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "community_revisions_public_search_idx" ON "community_revisions" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "community_tags_name_unique" ON "community_tags" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "community_tags_slug_unique" ON "community_tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "community_tags_order_idx" ON "community_tags" USING btree ("active","sort_order","name");--> statement-breakpoint
CREATE INDEX "community_works_author_idx" ON "community_works" USING btree ("author_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "community_works_public_idx" ON "community_works" USING btree ("lifecycle_status","featured_at" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "official_batches_admin_created_idx" ON "official_batches" USING btree ("admin_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_community_source_work_id_community_works_id_fk" FOREIGN KEY ("community_source_work_id") REFERENCES "public"."community_works"("id") ON DELETE set null ON UPDATE no action;
