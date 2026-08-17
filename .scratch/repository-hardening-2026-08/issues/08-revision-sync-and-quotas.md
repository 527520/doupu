# 08 revision 同步、冲突副本、分页与配额

Status: ready-for-human

Blocked by: 07

## Outcome

本地保存后立即后台同步；UI 分开显示本地/云端状态；revision 条件写阻止静默覆盖；冲突保留云端原件并创建本地副本；分页、墓碑和配额可长期运行。

## Tracer Bullet

两个 adapter 客户端从 revision 1 同时修改：A 成功写 revision 2，B 收到 409 后保留云端 A 并创建带提示的本地冲突副本。

## Implementation

- 设计和自定义色板添加 revision/baseRevision；Route 原子 compare-and-swap。
- 保存后后台 enqueue sync；离线重试幂等，local/cloud 状态分栏。
- list 为 50 条 cursor；同步按页并限制并发，移除三次重复 list。
- delete 立即清 project payload；90 日 hard delete；事务内约束 active rows/total rows/bytes。
- Fake、Route/PGlite、PostgreSQL 使用同一 adapter contract。

## Acceptance Tests

- 双设备交错 PUT、超时后服务端实际成功、离线删除/复活、时钟偏差均无静默覆盖。
- 99 条并发双创建最终不超过配额；字节配额竞态同样成立。
- 墓碑 payload 为空且 90 日清理；100+ 项分页完整无重复。

## Files

DB schema/migrations、design/palette routes、storage/sync、DesignsView、contract tests
