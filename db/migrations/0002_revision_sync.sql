ALTER TABLE "designs" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "designs" ADD COLUMN "payload_bytes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "designs" ALTER COLUMN "project" DROP NOT NULL;
--> statement-breakpoint
UPDATE "designs" SET "payload_bytes" = octet_length("project"::text) WHERE "project" IS NOT NULL;
--> statement-breakpoint
UPDATE "designs" SET "name" = '', "project" = NULL, "payload_bytes" = 0 WHERE "deleted_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_revision_positive" CHECK ("revision" > 0);
--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_tombstone_payload" CHECK (("deleted_at" IS NULL AND "project" IS NOT NULL) OR ("deleted_at" IS NOT NULL AND "project" IS NULL AND "payload_bytes" = 0));
--> statement-breakpoint
ALTER TABLE "palettes" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "palettes" ADD COLUMN "payload_bytes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "palettes" ALTER COLUMN "colors" DROP NOT NULL;
--> statement-breakpoint
UPDATE "palettes" SET "payload_bytes" = octet_length("colors"::text) WHERE "colors" IS NOT NULL;
--> statement-breakpoint
UPDATE "palettes" SET "name" = '', "colors" = NULL, "payload_bytes" = 0 WHERE "deleted_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "palettes" ADD CONSTRAINT "palettes_revision_positive" CHECK ("revision" > 0);
--> statement-breakpoint
ALTER TABLE "palettes" ADD CONSTRAINT "palettes_tombstone_payload" CHECK (("deleted_at" IS NULL AND "colors" IS NOT NULL) OR ("deleted_at" IS NOT NULL AND "colors" IS NULL AND "payload_bytes" = 0));
