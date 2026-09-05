# 02 社区引用绕过设计数量与容量配额

Status: ready-for-agent
Priority: P1
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/community/interactions.ts:110–143；src/app/api/community/works/[id]/reuse/route.ts；对照 src/app/api/designs/[id]/route.ts

## Reproduction

为已验证用户准备 100 个设计以及达到 50 MiB 的 payloadBytes 使用量，引用一个已发布作品。

## Actual

引用成功，设计数为 101，总 payloadBytes 为 52429401，超过 52428800 上限。

## Expected

引用创建的私人设计遵循普通云端保存的活动数量、总行数、总字节数配额，以及共享的用户级并发保护。

## Evidence

隔离 PGlite 执行现有服务函数复现。

## Acceptance

满配额时引用失败且无设计、引用事实、计数或幂等成功结果残留；并发引用与普通保存不得共同突破配额；幂等重放仍返回同一结果。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 引用与普通云端保存共用用户级配额锁和活动数量、墓碑总行数、总字节检查；失败回滚设计、引用事实、计数和幂等记录。PGlite 三类满额测试与 PostgreSQL 16 普通保存／两个不同幂等引用并发争用测试通过。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
