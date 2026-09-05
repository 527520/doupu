# 01 服务端页面中的会话续期写入只读 Cookie

Status: ready-for-agent
Priority: P1
Baseline: 6f44fbc
Verified: 2026-09-05

## Location

src/lib/auth/session.ts:130–152；src/app/admin/layout.tsx:10

## Reproduction

以 16 天前创建、仍有效的默认 30 天会话调用 getSessionActor；Cookie 容器使用当前 Next.js 的 RequestCookiesAdapter.seal。

## Actual

抛出 Cookies can only be modified in a Server Action or Route Handler；数据库续期已执行但浏览器 Cookie 未续期。

## Expected

服务端页面能解析有效会话；Cookie 更新由允许写 Cookie 的请求边界处理。

## Evidence

Next.js 真实只读 Cookie 适配器 + 隔离 PGlite 请求上下文复现；不是浏览器 E2E。

## Acceptance

覆盖续期前、续期窗口、绝对过期边界；服务端页面读取不能抛 Cookie 写入异常；合法响应入口同时完成数据库与浏览器续期。

## Comments

- 2026-09-05：按用户请求登记，尚未修复。当前后续任务为只读体验探索。

## Fix and verification

- 2026-09-05：用户授权主会话实施修复，原只读记录阶段结束。
- 会话解析默认只读；Route Handler 显式续期并写浏览器 Cookie。真实 Next.js 只读适配器覆盖续期前、续期窗口、绝对截止边界；API 续期检查数据库与 Cookie 的同一截止时间。
- 当前为针对性验证；完整门禁及双轴审查结果汇总于 [审查记录](../spec.md)。
