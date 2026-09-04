# 08 全量隐私、权限与发布门禁

Status: ready-for-agent

Blocked by: 07

## Outcome

从 0004 的现存数据安全升级，完整本地门禁通过，并以双轴 review 证明实现符合仓库标准与本规范。

## Tracer Bullet

临时 PostgreSQL 16 从 0004 带用户/设计/分享数据升级到最新迁移，应用启动后原数据可读且所有新约束成立。

## Acceptance Tests

- PGlite、真实 PostgreSQL 16 并发/回滚/EXPLAIN/维护重入。
- lint、typecheck、覆盖率、性能、三浏览器稳定 E2E、生产 build。
- 公开 HTML/API、日志与分析表隐私扫描。
- 回滚说明明确有数据后仅回滚应用；法律、生产备份/迁移/部署和真机仍为上线阻断项。
