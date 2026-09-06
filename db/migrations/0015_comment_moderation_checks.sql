SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TYPE "public"."community_comment_status" ADD VALUE IF NOT EXISTS 'rejected';--> statement-breakpoint
CREATE TABLE "comment_moderation_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid,
	"user_id" uuid,
	"work_id" uuid,
	"text_hash" text NOT NULL,
	"text_length" integer NOT NULL,
	"provider" text NOT NULL,
	"suggestion" text,
	"label" text,
	"sub_label" text,
	"score" integer,
	"keywords" jsonb,
	"tms_request_id" text,
	"latency_ms" integer,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_moderation_checks" ADD CONSTRAINT "comment_moderation_checks_comment_id_community_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."community_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_checks" ADD CONSTRAINT "comment_moderation_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_checks" ADD CONSTRAINT "comment_moderation_checks_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_moderation_checks_created_idx" ON "comment_moderation_checks" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comment_moderation_checks_user_idx" ON "comment_moderation_checks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comment_moderation_checks_hash_idx" ON "comment_moderation_checks" USING btree ("text_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comment_moderation_checks_comment_idx" ON "comment_moderation_checks" USING btree ("comment_id");