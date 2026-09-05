# 2026-09-05 代码缺陷审查记录

Status: accepted
State: closed
Resolution: implemented-and-verified
Closed: 2026-09-05

## Initial scope（登记时的历史基线）

最初基于 `6f44fbc` 做只读代码审查。用户当时要求先登记缺陷、随后开展只读用户体验探索；登记时尚未修复。后续执行授权、实现与当前验证结论见下方 Remediation。

共 9 项：3 项 P1、6 项 P2。6 项使用独立内存 PGlite 执行现有业务代码复现，1 项使用真实 Next.js 只读 Cookie 适配器及隔离 PGlite 请求上下文复现，2 项由源码调用链确认。未访问现有或生产数据库，未执行全量门禁或真机验证。

## Issues

- [P1 服务端页面中的会话续期写入只读 Cookie](issues/01-session-renewal-server-components.md)
- [P1 社区引用绕过设计数量与容量配额](issues/02-community-reuse-quota.md)
- [P1 注销后公开作者搜索仍暴露旧名称关联](issues/03-anonymized-author-search.md)
- [P2 部分发布后剩余官方草稿无法继续发布](issues/04-official-batch-partial-publication.md)
- [P2 历史日 UV 相加各事件 UV 导致重复计数](issues/05-analytics-daily-uv-overcount.md)
- [P2 评论编辑清空审核时间导致后续编辑窗口错误](issues/06-comment-edit-publication-time.md)
- [P2 连续合并标签后旧标签入口无法找到作品](issues/07-tag-merge-chain.md)
- [P2 作者删除入口错误受 15 分钟编辑窗口限制](issues/08-comment-delete-affordance.md)
- [P2 举报后台缺少被举报对象的内容和定位入口](issues/09-report-target-inspection.md)

## Initial boundaries（登记阶段）

- 记录阶段只新增本目录文档，不修改代码、不提交 Git。
- 保留用户现有 `docs/marketing/`，不读取其内容、不修改、不提交。
- 后续用户体验探索区分当前代码事实、流程推演与拟议方案；涉及业务语义、数据范围或安全边界的变更先由用户确认。

## Remediation

用户随后明确授权主会话修复上述九项缺陷，修复仍以 `6f44fbc` 为基线。侧会话的 HTML 体验提议不作为本轮业务变更范围。

九项缺陷及复核追加问题均已修复，针对性回归、完整本地门禁与双轴复核通过，九票已关闭；当前验证范围内无已知未解决缺陷。新增迁移 `0012_comment_publication_time` 只添加可空字段，不改写现有图纸协议；旧评论兼容原时间字段。迁移、空新业务数据时的 down SQL 与再升级已在隔离 PostgreSQL 16 中通过。

实现提交：`8c1d986`（九项原始缺陷）、`629937e`（复核发现的并发与匿名化边界）。本记录不复用上一轮门禁作为当前代码的验证结论。

### 复核追加修复

- 后台 Server Component 只读会话；导航和恢复到前台时通过合法 HTTP 响应同步续期。
- 所有账号关联写入在事务内重验 active，角色/暂停/注销与 CLI 共用咨询锁；注销与保存、引用、点赞、评论、发信令牌和分析身份关联并发时不重建私人数据。
- 注销撤回本人未发布的非官方修订，保留已有公开版；清除审核/处置/精选身份与跨操作者幂等响应中的旧身份副本。
- 批次生成完成与草稿发布分离；失败或取消项可重试，剩余草稿仍可再次勾选发布。创建请求防重入，迟到恢复响应不覆盖新文件。
- 官方发布/下架与作品/评论治理统一资源锁序，实际 PostgreSQL 并发以状态冲突正常结束而非死锁。

### 当前候选验证证据

| 层次 | 当前证据 |
| --- | --- |
| 静态 | lint、typecheck、Drizzle journal check、diff whitespace check 通过 |
| PostgreSQL 16 | 8 项并发合约通过；含普通账号/管理员注销时 4 路写入等待、配额竞争、最后管理员保护、点赞/引用/发布及发布/下架竞争 |
| 迁移 | 带现存用户/设计/分享的 0004 → 0012 升级、仅空新增业务数据时 down、再升级通过 |
| 候选镜像 | Docker 内生产构建通过，`doupu-app:review-fixes`；manifest `sha256:1560786e7ee2014539a4177310a9b58de960fafed6fbba6eca6f182717f493d0` |
| 镜像与真实数据库 | 候选镜像迁移与只读协议预检、HTTP 设计/色板 CAS/配额/墓碑/分页合约通过 |
| 本地生产构建浏览器 | 3 项通过：老管理员会话 RSC 读取及数据库/Cookie 同步续期、CSP/RSC/生成 Worker、HTTP CAS/一次性令牌 |
| 容器 CLI | 临时已验证账号 grant/revoke、审计与会话撤销通过；撤销最后管理员被拒绝且事务未改数据 |
| 双轴审查 | Spec 与 Standards 最终均无剩余的已确认问题；修复后再次复核，并非只依据初次审查 |
| 全量覆盖率 | 最后冻结候选 154 个文件、1230 项通过；macOS 按既有平台条件跳过 13 项 Linux 专用发布脚本测试。语句 90.51%、分支 81.95%、函数 94.78%、行 94.11%，原门槛通过 |
| Linux 脚本补测 | 隔离 Node 20 Alpine 容器中 `releaseSafety.test.ts` 29 项全部通过，覆盖上述 13 项平台专用用例；仅使用假备份/假 Docker 适配器，不部署、不访问生产 |
| 稳定 E2E | Chromium、Firefox、WebKit 连续三轮通过；每轮 162 通过、18 项按浏览器能力/重复矩阵预期跳过；0 retries；三轮分别耗时 7.5 / 6.4 / 6.7 分钟 |
| 稳定性能 | 其他重型测试结束后独立连续五轮通过；每轮 4 个文件、7 项测试，200×200/291 色生成仍使用原 2000 ms 门槛，未放宽阈值 |

### 不隐藏的失败与修复

- 初轮全量发现 Firefox/WebKit 的恢复请求覆盖新文件；已以延迟响应回归修复，两浏览器后续针对性用例通过。
- 初轮覆盖率中工作台 300 ms 防抖与默认 1 s 等待发生时序竞争；改为显式推进防抖时钟，不放宽业务断言，后续全量通过。
- 性能与覆盖率、三浏览器并跑时，200×200/291 色生成耗时 2201 ms，超出原 2000 ms 阈值。未放宽阈值；重型任务结束后独立五轮均通过，失败那次不计作通过。
- 并跑 lint 时发现 Playwright 临时 trace 的第三方运行时 JS 被误当源码检查；仅补充已被 Git 忽略的 `test-results/**` 生成目录排除，业务和测试源码不排除。修复后 lint/typecheck/Drizzle check 通过，独立 Standards 复核无发现。

以上均为本地、PGlite、PostgreSQL 16 或浏览器模拟证据；没有真机和生产验证。未 push、未 deploy、未访问生产。法律审查、真实生产备份/迁移/部署与真机验证仍是上线前独立闸门。`docs/marketing/` 保持原有未跟踪状态，未读取内容、未修改、未提交。

本轮一次性应用/数据库测试容器及匿名数据卷已删除，Linux 补测容器自动删除；仅移除可重建测试数据，不涉及用户数据。候选应用镜像 `doupu-app:review-fixes` 保留供本地复核。
