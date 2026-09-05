# 2026-09-05 代码缺陷审查记录

Status: accepted

## Scope

基于 `6f44fbc` 的只读代码审查。用户要求先登记缺陷，随后开展只读用户体验探索；本记录不表示已修复，也不授权在当前探索中修改业务代码。

共 9 项：3 项 P1、6 项 P2。6 项使用独立内存 PGlite 执行现有业务代码复现，1 项使用真实 Next.js 只读 Cookie 适配器及隔离 PGlite 请求上下文复现，2 项由源码调用链确认。未访问现有或生产数据库，未执行全量门禁或真机验证。

## Issues

- [P1 服务端页面中的会话续期写入只读 Cookie](issues/01-session-renewal-server-components.md)
- [P1 社区引用绕过设计数量与容量配额](issues/02-community-reuse-quota.md)
- [P1 注销后公开作者搜索仍暴露旧名称关联](issues/03-anonymized-author-search.md)
- [P2 部分发布后剩余官方草稿无法继续发布](issues/04-official-batch-partial-publication.md)
- [P2 历史日 UV 相加各事件 UV 导致重复计数](issues/05-analytics-daily-uv-overcount.md)
- [P2 评论编辑清空审核时间导致后续编辑窗口错误](issues/06-comment-edit-publication-time.md)
- [P2 连续合并标签后旧标签入口无法找到作品](issues/07-tag-merge-chain.md)
- [P2 作者删除入口错误受 15 分钟编辑窗口限制](issues/08-comment-delete-affordance.md)
- [P2 举报后台缺少被举报对象的内容和定位入口](issues/09-report-target-inspection.md)

## Boundaries

- 记录阶段只新增本目录文档，不修改代码、不提交 Git。
- 保留用户现有 `docs/marketing/`，不读取其内容、不修改、不提交。
- 后续用户体验探索区分当前代码事实、流程推演与拟议方案；涉及业务语义、数据范围或安全边界的变更先由用户确认。

## Remediation

用户随后明确授权主会话修复上述九项缺陷，修复仍以 `6f44fbc` 为基线。侧会话的 HTML 体验提议不作为本轮业务变更范围。

目前已完成九项代码修复及针对性回归。新增迁移 `0012_comment_publication_time` 只添加可空字段，不改写现有图纸协议；旧评论兼容原时间字段。迁移、空新业务数据时的 down SQL 与再升级已在隔离 PostgreSQL 16 中通过。

完整门禁与双轴审查待本轮最终结果；本记录不会复用上一轮局部门禁作为当前代码的全量结论。
