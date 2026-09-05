# 06 评论编辑清空审核时间导致后续编辑窗口错误

Status: ready-for-agent
Priority: P2
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/community/interactions.ts:185–200

## Reproduction

01:00 创建待审评论，03:00 审核发布；03:01 安全编辑成功，03:02 再次安全编辑。

## Actual

第一次编辑清空 reviewedAt；第二次回退到 createdAt 检查窗口并返回 FORBIDDEN。

## Expected

15 分钟窗口依据实际发布时间，安全编辑不得把该时间回退为创建时间。

## Evidence

隔离 PGlite 执行评论创建、审核和两次编辑复现。

## Acceptance

延迟审核后的连续安全编辑在有效窗口内成功；超过窗口拒绝；高风险编辑重新待审的时间语义保持明确。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 迁移 0012 增加可空 published_at，审核时间与编辑窗口分离；历史行按原审核／创建时间惰性兼容。延迟审核后连续安全编辑与超时拒绝测试通过；配套 down SQL 仅限尚未写入新业务数据。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
