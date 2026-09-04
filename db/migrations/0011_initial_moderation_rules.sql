INSERT INTO "moderation_rule_set_versions" (
  "id", "version", "rules", "active", "reason"
)
SELECT
  'f0c81a4d-a5d8-4d6a-97e4-e42dc8ca9cc8',
  1,
  '[{"literal":"杀了你","category":"harm","risk":"review"},{"literal":"去死","category":"harm","risk":"review"},{"literal":"废物","category":"harassment","risk":"review"},{"literal":"滚出去","category":"harassment","risk":"review"},{"literal":"成人视频","category":"sexual","risk":"review"},{"literal":"色情交易","category":"sexual","risk":"review"},{"literal":"加微信","category":"spam","risk":"review"},{"literal":"代刷","category":"spam","risk":"review"}]'::jsonb,
  true,
  '豆谱内置初始治理词表'
WHERE NOT EXISTS (SELECT 1 FROM "moderation_rule_set_versions");
