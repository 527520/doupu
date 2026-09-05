# 04 部分发布后剩余官方草稿无法继续发布

Status: ready-for-agent
Priority: P2
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/community/officialBatch.ts:140–143；src/components/admin/OfficialBatchStudio.tsx:206–215

## Reproduction

一个批次成功保存 A、B 两份草稿，只勾选 A 发布，然后使用最新批次版本发布 B。

## Actual

首次发布把整个批次置为 completed；B 仍为 draft，但第二次发布返回 STATE_CONFLICT，界面入口也禁用。

## Expected

明确勾选决定本次发布范围；未勾选的合法草稿仍应有可达的后续处置流程。

## Evidence

隔离 PGlite 执行批次保存及两次发布复现。

## Acceptance

部分发布后剩余草稿可后续选择发布；不隐式发布未勾选项；批次生成完成、取消及草稿发布之间的生命周期需保持一致。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 已完成或已取消的生成批次仍可显式发布保留的合法草稿；部分发布不终止未完成的生成。客户端区分已保存／已发布项目，刷新后不重复勾选已发布内容。服务测试覆盖二次发布、发布后继续保存和取消后发布。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
