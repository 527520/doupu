# ADR-0005: Deployment — 腾讯云 single host, Docker Compose, Caddy, COS backups

- Status: accepted
- Date: 2026-08-14

## Context

Deployment target: 腾讯云海外地域 lightweight server, single Docker host (~50–100 CNY/month), with D31 superseding the earlier mainland/ICP decision D11. Email via 腾讯云邮件推送. The user performs the human-only steps (buying the server, domain and DNS) guided by our checklist.

## Decision

- `docker-compose.prod.yml` with four services: `app` (gated Next.js standalone image), `postgres` (volume-persisted), `caddy` (reverse proxy + automatic TLS via Let's Encrypt HTTP-01; redirects HTTP→HTTPS; security headers), and `backup`.
- Nightly verified `pg_dump` via the `backup` sidecar's fail-fast scheduling loop, uploaded to 腾讯云 COS with 30-day retention; restore procedure documented in `deploy/`. Backup or alert-path failure exits non-zero after bounded container retries instead of sleeping silently.
- Secrets live in `.env` on the server (gitignored); `.env.example` documents every variable.
- GitHub Actions CI runs the complete static/coverage/integration/performance/E2E/release-safety suite for a stable tag. `deploy/scripts/deploy.sh` accepts only that release's stable GHCR tag or immutable digest, pulls it, and starts it with `--no-build`; production never rebuilds the app from an arbitrary server checkout.
- 协议单向升级前，构建阶段用 esbuild 将应用正式的 ProjectFile/ShareSnapshot schema 打包成独立 CommonJS 只读检查器（仅外置运行时已有的 `pg`）；运行镜像不维护第二套协议或色板规则。部署先在入口仍在线时执行一次快速预检；通过后停止 Caddy，再在数据库迁移前用同一候选镜像做最终检查，从而消除旧应用在预检后继续写入旧协议数据的竞态。终检失败且迁移尚未开始时恢复原 Caddy；迁移一旦开始则禁止恢复旧协议入口。检查器先用 PostgreSQL `to_regclass` 判断协议表是否存在：两表均不存在时视为全新空库并允许后续迁移；`designs` 已存在就严格检查活动设计；`design_shares` 不存在时允许迁移创建，存在时严格检查全部分享。发现任何活动旧协议数据即失败，且检查过程不自动迁移、删除或写入数据。
- Overseas-region selection, domain and DNS are documented as a step-by-step human checklist in `deploy/CHECKLIST.md`; moving the service to a mainland region requires a new decision and ICP workflow before traffic is switched.
- 迁移 CLI 使用独立数据库连接持有 `doupu:database.migrate` 会话咨询锁，有限锁/语句/连接超时。真正应用新迁移时在 `maintenance_runs` 的 `database.migrate` 任务中记录开始/完成时间和迁移序号、文件时间、hash；无新迁移时不写成功记录、不倒填历史执行时间。系统页只接受与当前迁移身份完全匹配的成功记录。执行记录缺失明确显示“未记录”，不将 Drizzle 的 `created_at`（journal 文件时间）当实际执行或部署时间。

## Consequences

- Single point of failure is accepted; RTO after server loss ≈ image redeploy + latest nightly restore.
- Caddy terminates TLS; the app container itself is not exposed publicly.
- The current overseas deployment does not claim an ICP filing number; mainland migration remains a separate compliance project.
- 发布前协议检查与候选应用来自同一镜像，因此检查结论对应即将切流的正式 schema；在线预检失败时当前服务与数据库均保持原状，停流终检失败时数据库仍未迁移并自动恢复原入口。全新空库或缺少后续版本表的旧库只跳过不存在的表，由紧随其后的幂等迁移创建。CI 必须在 PostgreSQL 16 上运行最终镜像内的检查器，覆盖空库、合法 v3、旧活动设计/分享拒绝及拒绝路径只读性。
- 迁移事务成功与执行记录写入不是同一事务；若后者失败，CLI 返回 `MIGRATION_EVIDENCE_FAILED`，迁移可能已完成，不得据此进行破坏性降级。缺失时间保持未知，后续无操作重跑不会伪造原执行时间。驱动错误仅输出稳定错误码，不输出 SQL 参数、连接串或凭据；迁移连接结束时销毁，避免咨询锁/会话设置泄漏。生产备份、迁移与部署依然需要实际授权和环境证据，本地演练不能代替。
