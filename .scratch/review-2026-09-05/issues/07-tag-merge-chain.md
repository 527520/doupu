# 07 连续合并标签后旧标签入口无法找到作品

Status: ready-for-agent
Priority: P2
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/community/queries.ts:154–159；src/lib/community/adminService.ts:178–209

## Reproduction

作品先关联标签 A，执行 A 合并到 B，再把 B 合并到 C；分别按 A 与 C 搜索。

## Actual

A 只解析一层到 B，查询返回 0；实际关联已迁移到 C，按 C 返回 1。

## Expected

历史标签指向最终有效标签，连续合并后旧入口仍能到达相同作品集合。

## Evidence

隔离 PGlite 执行关联迁移、两次合并与公开查询复现。

## Acceptance

A→B→C 的 A/B/C 查询结果一致；禁止环路和合并到无效目标；修订标签去重。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 公开查询递归解析整个合并链，UNION 去重保证异常环路有限终止；合并按固定顺序锁定标签并拒绝环路／无效目标。A→B→C 的旧入口、终点和修订去重结果回归通过。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
