# 03 注销后公开作者搜索仍暴露旧名称关联

Status: ready-for-agent
Priority: P1
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/community/queries.ts:150–153；src/lib/auth/accountLifecycle.ts

## Reproduction

使用独特用户名发表作品，注销账号，再用旧用户名调用公开作品列表的 author 筛选。

## Actual

仍返回该用户作品，展示名虽为已注销用户，但旧用户名与公开作品仍可关联。

## Expected

注销后的公开搜索不得通过历史冻结名称恢复已移除的显示身份。

## Evidence

隔离 PGlite 执行注销与公开查询复现。

## Acceptance

旧用户名及其唯一片段不能再通过公开 author 搜索定位匿名化作者；正常作者搜索和作品可见性保持正确；公开作者 ID 的保留语义遵循既定契约。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 作者搜索改用公开 DTO 一致的当前可展示名称，匿名化作者不再匹配旧名或唯一片段；保留随机公开作者 ID 的既定可检索语义。PGlite 实际匿名化＋查询回归通过。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
