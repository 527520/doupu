SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "community_originals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"cos_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community_originals" ADD CONSTRAINT "community_originals_revision_id_community_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."community_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_originals" ADD CONSTRAINT "community_originals_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_originals" ADD CONSTRAINT "community_originals_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_originals_revision_unique" ON "community_originals" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "community_originals_work_idx" ON "community_originals" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "community_originals_key_idx" ON "community_originals" USING btree ("cos_key");--> statement-breakpoint
CREATE INDEX "community_originals_blocked_idx" ON "community_originals" USING btree ("blocked_at") WHERE "community_originals"."deleted_at" is null and "community_originals"."blocked_at" is not null;--> statement-breakpoint
CREATE INDEX "community_originals_purge_idx" ON "community_originals" USING btree ("deleted_at") WHERE "community_originals"."deleted_at" is not null and "community_originals"."purged_at" is null;