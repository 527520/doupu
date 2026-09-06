# 03 管理员快速打标与按标签筛选（D51）

Status: ready-for-human
Completion: complete

## 交付

- 迁移 `0013_work_tags`：`community_work_tags` 作品级标签表，并把历史修订标签迁到当前公开修订所属作品；旧表停写。
- `adminService`：`setCommunityWorkTags`（整体替换、现打现建、跟随合并链）、`addTagsToCommunityWorks`（批量追加）；`createCommunityTag` 的 slug 可省略（中文名派生哈希 slug）。
- API：`PUT /api/admin/community/works/[id]/tags`、`POST /api/admin/community/works/tags`；后台标签列表支持 `?q=` 联想并返回使用数。
- UI：`TagInput` 芯片输入组件；作品管理详情打标 + 列表多选批量打标；`TagsManager` 去掉 slug 输入；投稿表单移除标签勾选。
- 豆社：热门标签芯片栏、当前标签可一键取消、`?tag=<名称>` 筛选（兼容旧 slug）、搜索同时匹配标签名。
