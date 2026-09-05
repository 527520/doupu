# 08 作者删除入口错误受 15 分钟编辑窗口限制

Status: ready-for-agent
Priority: P2
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/components/community/CommunityInteractions.tsx:123；src/lib/community/interactions.ts:211–257

## Reproduction

已发布的本人评论超过编辑窗口，列表 DTO 的 editable 变为 false。

## Actual

编辑、删除按钮共同放在 item.editable 条件下，删除入口消失；服务端删除没有相同时间限制。

## Expected

编辑资格与删除资格独立；作者能在允许删除的状态下找到自己的删除操作。

## Evidence

静态界面与服务调用链核实；未执行浏览器走查。

## Acceptance

窗口内可编辑及删除；窗口外不能编辑但仍可删除；他人评论没有删除入口；待审等状态的作者管理入口有明确覆盖。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- DTO 分离 editable 与 deletable，评论锁也参与编辑资格判断；作者可看到并删除自己的待审／隐藏评论，游客与他人看不到这些非公开内容。服务测试与三浏览器删除旧评论／待审评论的真实页面旅程通过。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
