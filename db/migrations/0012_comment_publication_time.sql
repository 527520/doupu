SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE "community_comments" ADD COLUMN "published_at" timestamp with time zone;
