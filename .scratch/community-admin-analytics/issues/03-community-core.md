# 03 豆社作品、冻结修订与公开页面

Status: ready-for-agent

Blocked by: 01

## Outcome

用户可从私人设计创建冻结投稿，moderator 审核后以稳定作品 URL 公开；修改审核期间旧版继续展示。

## Tracer Bullet

创建 draft、提交、审核发布后公开详情可读；再提交第二版时详情仍返回第一版，第二版批准后原子切换并 supersede 第一版。

## Acceptance Tests

- 快照严格校验、48×48 预览、公开作者 DTO、状态机和 CAS。
- 24 条游标、标题/作者/标签/规格/色板/日期筛选与稳定排序。
- 撤回、下架、恢复、精选、评论锁和审计。
- 公开 metadata/sitemap/robots；非公开内容 404/noindex。
