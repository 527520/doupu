ALTER TABLE "sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "sessions"
SET "absolute_expires_at" = LEAST("expires_at", "created_at" + interval '90 days');
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "absolute_expires_at" SET DEFAULT now() + interval '90 days';
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;
