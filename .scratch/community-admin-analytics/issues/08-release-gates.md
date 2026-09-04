# 08 全量隐私、权限与发布门禁

Status: ready-for-human

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

## Comments

- 2026-09-05：双轴审查发现的版本去重、批次参数隐私、评论重审、注销去身份化、分析维护回填、分享 token 路径、社区来源漏斗、页面近数据鉴权与后台工作流缺口均已修复并回归。
- 静态与构建：lint、typecheck、Drizzle check、Next.js 生产 build、生产依赖 audit（0 vulnerabilities）通过。
- 稳定性：全量覆盖率 5/5 轮通过（每轮 151 files；1214 passed、13 capability skips；statements 90.27%、branches 81.47%、functions 94.58%、lines 93.95%）；性能 5/5 轮通过。
- 浏览器：Chromium、Firefox、WebKit E2E 3/3 轮通过（每轮 154 passed、20 capability skips；0 retries）；覆盖 350/390/768/1280/1440 px 与 axe。
- PostgreSQL 16：当前迁移、CAS/配额、治理并发、0004 带现存数据升级、空业务数据 down SQL 与再升级、候选镜像 strict-v3 预检全部通过；50k 分析事件 EXPLAIN 命中时间索引。
- 候选镜像：原生 Argon2、standalone CSP/RSC/Worker、真实 HTTP 路由事务与生产 Chromium 通过；公开 HTML/API、运行日志及分析事件表隐私探针通过。
- 本轮证据仅覆盖本地、容器、浏览器模拟和临时 PostgreSQL 16；未执行 push、部署、生产访问或真机验证。法律文案专业审核、真实生产备份确认、迁移演练、部署和真机验证仍是上线前阻断项。
