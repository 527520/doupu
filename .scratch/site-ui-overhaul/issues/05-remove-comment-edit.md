# 05 删除评论编辑能力

Status: ready-for-human
Completion: complete

## 目标

评论只能发表与删除，不能编辑。彻底移除相关代码与文案，数据库列停写保留。

## 范围

- 前端：`CommunityInteractions.tsx` 的 `editingId/editingBody/editComment`、内联编辑框、「编辑」按钮、`editable/editedAt` 字段。
- API：`PATCH /api/community/comments/[id]` 与 `editSchema`。
- 服务：`editCommunityComment()`；`listCommunityComments` DTO 去 `editedAt/editable`；`commentModeration.ts` 的 `excludeCommentId` 分支与 `ne` 导入；`config.ts` 注释措辞。
- 埋点：`community_comment_edited` schema。
- 文案：`communityAdmin.interaction` 的 `edit/saveEdit/cancelEdit/editPending/updated/editFailed`；隐私政策「发表或修改评论」改「发表评论」。
- 测试：`db/communityInteractions.test.ts` 编辑用例删除、`editable` 断言删除；E2E `12` 中「评论删除独立于编辑窗口」用例改名并改断言为「无编辑入口」。
- 文档：`CONTEXT.md` 术语「评论发布时间」改为「评论进入公开态的时间戳，仅作展示与审计」；ADR-0020 补注「编辑能力已于本轮移除」；新 ADR 记录列保留决定。

## 验收

- `rg -i "editComment|editingBody|comment_edited|excludeCommentId" src tests db` 为 0。
- 全量单测/E2E 通过。
