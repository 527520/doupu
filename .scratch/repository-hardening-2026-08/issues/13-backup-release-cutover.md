# 13 备份、发布与单向切换

Status: ready-for-human

Blocked by: 01, 02, 08, 09, 10, 11, 12

## Outcome

备份只有在可验证并可恢复时成功；告警链在生产可用；迁移成功后才切流；tag 复用完整门禁并保持版本单调；一次短维护窗完成单向升级。

## Tracer Bullet

在临时 PostgreSQL 16 写入 canary，执行真实 backup→upload/download→restore 并校验；随后用失败迁移证明旧 app 仍服务、未提升新镜像。

## Implementation

- backup 使用 pipefail 或无管道分步：dump temp→pg_restore/list 校验→compress→upload temp key→校验→原子 promote。
- 定期自动 restore drill；修复 SES/template/from 配置和 fail-fast。
- deploy 用一次性 migration job，成功后启动/健康检查新 app 再切 Caddy；失败保持旧实例。
- release workflow 调用完整 quality workflow，校验 tag commit 属于受保护 main、package/app/changelog 一致、版本高于 latest。
- Docker standalone+Node20+native Argon2+PostgreSQL migration smoke 进入门禁；修复部署文档漂移。

## Acceptance Tests

- 任一 dump/validate/compress/upload 失败均非零退出且告警成功；恢复 canary 完整。
- migration failure 不切流；成功路径旧 schema→migration→new app 健康。
- coverage/performance 连续 5 次，三浏览器 E2E 无重试连续 3 次，audit/standalone/PostgreSQL/backup 全绿后才允许 tag。

## Files

backup/deploy scripts、compose、release/CI workflows、version source、deploy docs/tests
