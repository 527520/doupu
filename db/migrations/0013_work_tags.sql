SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "community_work_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_work_tags" ADD CONSTRAINT "community_work_tags_work_id_community_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."community_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_work_tags" ADD CONSTRAINT "community_work_tags_tag_id_community_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."community_tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_work_tags" ADD CONSTRAINT "community_work_tags_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_work_tags_unique" ON "community_work_tags" USING btree ("work_id","tag_id");--> statement-breakpoint
CREATE INDEX "community_work_tags_tag_idx" ON "community_work_tags" USING btree ("tag_id","work_id");--> statement-breakpoint
-- 把作者过去在修订上勾选的标签迁到作品：优先当前公开修订，没有则取最新修订。
-- 已合并的标签沿合并指向落到终点标签；停用标签不迁移。
INSERT INTO "community_work_tags" ("work_id", "tag_id")
SELECT DISTINCT w.id, COALESCE(target.id, t.id)
FROM "community_works" w
JOIN "community_revisions" r ON r.id = COALESCE(
  w.current_published_revision_id,
  (SELECT r2.id FROM "community_revisions" r2 WHERE r2.work_id = w.id ORDER BY r2.revision_number DESC LIMIT 1)
)
JOIN "community_revision_tags" crt ON crt.revision_id = r.id
JOIN "community_tags" t ON t.id = crt.tag_id
LEFT JOIN "community_tags" target ON target.id = t.merged_into_tag_id AND target.active = true
WHERE (t.active = true OR target.id IS NOT NULL)
ON CONFLICT DO NOTHING;
