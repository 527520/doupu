# ADR-0006: Testing — 分层门禁与已知验收边界

- Status: accepted
- Date: 2026-08-14
- Last verified: 2026-08-17

## Context

交付要求核心生成引擎、数据安全和发布流程具有可重复的自动化证据。测试文档必须区分当前已落地能力和仍待完成的发布门禁，不得把目标或人工验收写成已有自动化覆盖。

## Decision

### 当前已实现

- 纯逻辑优先放在 `src/lib/` 下，使用 typed array 或普通数据作为输入输出，并用 Vitest 验证色彩、量化、抖动、合并、背景、编辑和项目文件等行为。
- Vitest 拆分为 `unit`、`serial`、`integration` 和 `performance` 项目。Argon2 与共享数据库状态的用例串行运行，性能测试不带覆盖率插桩。
- `src/lib` 覆盖率门禁为 lines/statements/functions ≥90%、branches ≥75%。认证数据库、Cookie 和事务边界从该插桩集合排除，由独立 integration job 执行。
- Route Handler 集成测试当前使用 PGlite 测试适配器。CI 另配置 PostgreSQL 16 迁移、原生 Argon2 smoke，以及 standalone 生产 Route 的设计/色板 CAS、设计行数与字节配额、墓碑、游标分页和令牌并发契约。
- Playwright 当前使用 Next 16 Turbopack 开发服务器，串行运行 Chromium、Firefox 和 WebKit；重试为 0，失败保留 trace。CI 连续运行 E2E 3 次。
- 当前入库图片 fixture 包括静态/animated GIF、animated WebP、透明 PNG、截断 PNG、小型照片 PNG、伪 HEIC、真实静态 HEIC、EXIF 旋转 JPEG，以及 8000×8000 / 100×8000 极限 PNG。
- 500 色 PDF 同时验证完整色号文本、分页，并解析产物 `Tm` 绘制坐标后用实际 Helvetica/Noto 字体宽度检查页边距与列边界。
- CI 分别执行 lint/typecheck/build、覆盖率连续 5 次、PGlite/API integration、性能连续 5 次、三引擎 E2E 连续 3 次，以及生产依赖审计、Node 20 standalone 镜像、PostgreSQL 16 迁移和临时 canary 备份恢复演练。Release workflow 复用该 CI workflow。

### 尚未被上述门禁证明

- 同步契约按 seam 分层：Fake 客户端验证冲突副本、离线/超时恢复与分页编排；PGlite 验证 Route/事务行为；standalone PostgreSQL 16 通过真实 HTTP 验证设计/色板 CAS、设计配额、墓碑和分页。三层覆盖相邻不变量，但不声称三层复用同一个客户端 adapter contract；PostgreSQL 结果仍以 CI 运行记录为准。
- 引擎固定素材 golden 已覆盖肤色渐变、像素画、贴边主体与透明抗锯齿；16-bit PNG、全白/全黑与灰度的文件级解码 fixture 是后续扩展覆盖项。
- production standalone 已验证 CSP nonce、RSC 导航、Worker、PostgreSQL CAS 和单次令牌消费；当前 iPhone/Pixel 用例仍是浏览器设备模拟，不等于真实 iOS Safari 和 Android Chrome。
- 大图使用有界 RGBA 预览，真实工作线程取消有 100ms 性能门禁，极限 PNG 做解码像素断言；新旧算法人工并排验收仍由发布负责人执行。
- CI 做临时 canary 恢复，另有定期 workflow 从真实 COS 下载最新备份并恢复到一次性 PostgreSQL 16；该 workflow 的成功记录仍属于外部发布证据。

## Consequences

- 测试名称、ADR 和发布报告只能声称实际执行过的环境与断言。设备模拟不得标记为实机通过，临时备份演练不得标记为生产备份恢复。
- 本 ADR 的“尚未被证明”项在相应 issue 验收前仍是发布阻断项，不因局部单测或 smoke 通过而自动关闭。
- 新增行为按 TDD 的可观测公开接口编写测试：单个 RED → 最小 GREEN → 必要时重构。
