# 05 历史日 UV 相加各事件 UV 导致重复计数

Status: ready-for-agent
Priority: P2
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/analytics/reports.ts:178–195；src/lib/analytics/maintenance.ts:47–57

## Reproduction

同一访客同一天记录两个客户端事件及服务端 session_started；生成日聚合，分别在精确与历史聚合模式查询当天趋势。

## Actual

精确模式 events=3、uniqueVisitors=1；聚合模式 events=3、uniqueVisitors=3。

## Expected

每日总 UV 在当日跨事件去重；不能把各事件的去重 UV 相加并标为当天 UV。

## Evidence

隔离 PGlite 执行采集、日聚合和报表查询复现。

## Acceptance

同日同访客多个事件的总 UV 为 1；单事件筛选正确；跨日 UV 继续明确不可用，不相加伪造。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 日聚合增加跨事件去重的总量及单维统计；单事件查询继续按事件过滤，跨日 UV 保持不可用。旧聚合缺少跨事件去重信息时保留事件总数，UV 返回 null 并显示原因，绝不伪造准确人数。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
