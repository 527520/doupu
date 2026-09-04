SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "community_revisions" ADD COLUMN "official_batch_id" uuid;--> statement-breakpoint
CREATE INDEX "community_revisions_official_batch_idx" ON "community_revisions" USING btree ("official_batch_id","created_at");
