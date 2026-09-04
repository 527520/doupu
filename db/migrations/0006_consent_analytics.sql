SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TYPE "public"."analytics_browser" AS ENUM('chrome', 'edge', 'firefox', 'safari', 'other');--> statement-breakpoint
CREATE TYPE "public"."analytics_deletion_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."analytics_device" AS ENUM('desktop', 'mobile', 'tablet', 'other');--> statement-breakpoint
CREATE TYPE "public"."analytics_os" AS ENUM('android', 'ios', 'linux', 'macos', 'windows', 'other');--> statement-breakpoint
CREATE TABLE "analytics_daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"event_name" text NOT NULL,
	"dimension_name" text DEFAULT 'all' NOT NULL,
	"dimension_value" text DEFAULT 'all' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"unique_visitors" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_token_hash" text,
	"status" "analytics_deletion_status" DEFAULT 'pending' NOT NULL,
	"deleted_event_count" integer DEFAULT 0 NOT NULL,
	"deleted_link_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence_in_batch" integer DEFAULT 0 NOT NULL,
	"app_version" text NOT NULL,
	"actor_type" text NOT NULL,
	"path" text NOT NULL,
	"referrer_domain" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"device_type" "analytics_device" NOT NULL,
	"browser_family" "analytics_browser" NOT NULL,
	"os_family" "analytics_os" NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	CONSTRAINT "analytics_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "analytics_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"user_id" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"current_session_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"session_last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_visitors_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_visitor_id_analytics_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."analytics_visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_identity_links" ADD CONSTRAINT "analytics_identity_links_visitor_id_analytics_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."analytics_visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_identity_links" ADD CONSTRAINT "analytics_identity_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_rollups_unique" ON "analytics_daily_rollups" USING btree ("day","event_name","dimension_name","dimension_value");--> statement-breakpoint
CREATE INDEX "analytics_daily_rollups_day_idx" ON "analytics_daily_rollups" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_deletion_requests_status_idx" ON "analytics_deletion_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "analytics_events_received_idx" ON "analytics_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id","occurred_at","received_at","sequence_in_batch");--> statement-breakpoint
CREATE INDEX "analytics_events_name_time_idx" ON "analytics_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_visitor_time_idx" ON "analytics_events" USING btree ("visitor_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_identity_links_visitor_user_unique" ON "analytics_identity_links" USING btree ("visitor_id","user_id");--> statement-breakpoint
CREATE INDEX "analytics_identity_links_user_idx" ON "analytics_identity_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_visitors_last_seen_idx" ON "analytics_visitors" USING btree ("last_seen_at");
