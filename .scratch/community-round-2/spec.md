# 豆社第二轮整改

Status: ready-for-human
Completion: complete

## Outcome

在现有 Next.js + PostgreSQL 单体中一次性交付：局域网选图无响应修复、豆社列表清晰缩略图、公开作品原图上传私有 COS 并按权限交付引用者、评论审核外部化到腾讯云文本内容安全、管理员快速打标与按标签筛选、官方批量卡片式布局与一键全选、管理后台与使用统计全部中文化、隐私与协议正式化。决策记录见 CONTEXT.md D49–D52 与 ADR-0019 / ADR-0020。

## Invariants

- 浏览器代码不得直接调用 `crypto.randomUUID`（ESLint 禁止），统一走 `randomId()`，局域网 HTTP 与 HTTPS 行为一致。
- 缩略图只按不可变修订渲染；公开修订允许长期缓存，未公开修订只对作者与审核员可见且不缓存。
- 公开作品必须附带原图；原图永不公开、只经服务端代理读写；访问者限原作者、审核员/管理员、已成功引用者。
- 私人设计的原图仍不上传服务器；引用交付到浏览器后两份图纸互不联动。
- 评论判定每一步留审计记录（不含正文）；服务不可用一律待审，绝不静默公开；被拦截评论不公开但治理台可见。
- 标签挂作品身份；打标写审计但不强制手填理由（D51 的有意放宽）。
- 管理后台与使用统计页面不出现英文角标、裸枚举或 UUID 作为主标签；状态一律走 `states.*` 映射。
- 隐私政策、社区规范、版权声明与所有同意条款使用正式表述，并如实描述原图与评论文本的处理方式。

## Verification

最终结果（2026-09-06，全部修复后在本机重跑）：

- 单元 / 集成：`npm run test` 190 文件 / 1517 通过 / 14 跳过（含新增：`ids`、`render/thumbnail`、`cos/client`、`community/originals` 场景、`moderation/*`、`batchSession` 上传与全选、`WorksManager` 打标、`CommunitySubmitForm` 原图步骤、`e2eServerProcess` 的 taskkill 非零退出码用例）。
- `npm run typecheck`、`npm run lint` 全绿。
- E2E 三浏览器全量 `npm run test:e2e`：244 通过 / 22 跳过 / 1 失败（13.2 分钟），唯一失败为下述已知环境问题 chromium `13-optional-recrop 手机 350px`；Firefox、WebKit 全绿；globalTeardown 无报错。`tests/e2e/helpers.ts` 新增 `uploadDraftOriginal`（API 夹具补原图）与 `settledClick`（WebKit 滚动后点击）。
- 已知与本轮无关：`13-optional-recrop` 的「手机 350px」用例在本机对基线提交同样失败（CDP 触控取消后弹窗不关闭），属环境 / Chromium 版本问题。`16-review-recovery` 需要 PATH 上有 `openssl`（Git 自带 `D:\tools\Git\usr\bin\openssl.exe` 可用，运行前 `$env:PATH = "D:\tools\Git\usr\bin;$env:PATH"`）。
- 测试基础设施（本轮收尾时处理）：
  - WebKit（Windows）Tab 永远到不了 `<a>`：Playwright 的 WebKit 构建沿用 Safari「Tab 只在表单控件间移动」默认值，仅 macOS 端口支持 Option+Tab 包含链接（Playwright 自家 `page-focus.spec.ts` 也只在 darwin 断言）。空白静态页 `<a><a><button><input>` 上实测 Tab / Alt+Tab 都直接落到 `button`。`14` 的「键盘跳转」用例在非 macOS WebKit 改为直接 `skip.focus()` 后验证 Enter 落到 `main`，Tab 顺序断言仍保留在 Chromium / Firefox / macOS WebKit。同时移除循环中已退役的 `rules` 段。
  - `tests/e2e/serverProcess.ts`：Windows 下 `taskkill /T` 在整轮测试后偶发返回 255（Turbopack 池工作进程随父进程退出后再被终止报「无运行实例」），但进程树与端口实际已释放。改为非零退出码只作诊断，端口释放才是成败依据；端口仍在监听时报错并附带退出码。

## E2E 收尾状态（2026-09-06）

E2E 暴露并已修复的真实缺陷：
1. `listOfficialBatches` 的 `hasOriginal` 用 `sql\`exists(...)\`` 内嵌在 select 字段里恒为 false → 恢复历史批次时所有草稿显示「原图未上传」。改为独立查询取集合；`db/officialBatch.test.ts` 补断言。
2. E2E 假内容安全服务通过 `setCommentModerationDeps` 在 instrumentation 注入，但 Next dev 里路由处理器持有另一份模块实例 → 拦截评论返回 201。改为 `src/lib/moderation/e2eFake.ts` + `DOUPU_E2E_SEED` 在 `interactions.ts` 内自行启用。
3. 审核台「图纸 + 原图」并排网格在 ≤900px 用 `1fr`，WebKit 把替换元素固有宽度算进最小轨道 → 390px 横向溢出。改 `minmax(0,1fr)` 并给子项 `min-width:0`。
4. `pendingOriginals.ts`（原图交接 IndexedDB）并发 open + 首次建库在 WebKit 上互相卡住 → 引用后不跳转工作台。改为模块级串行队列 + 5s open 超时；`CommunityInteractions.reuse` 顺序写入并给原图拉取加 8s 超时。
5. `Switch` 组件隐藏 input 为 1×1 且落在亚像素位置，Firefox 真实指针事件取整后命中旁边轨道 → `check()` 永远失败。改为 input 铺满整个控件（`globals.css .switch-control input`）。
6. 禁用态 `.batch-select-files`（label）灰字压在主色底上，axe 对比度不足 → 改背景不改文字色。
7. 文案/选择器漂移：E2E 12/14 的审核空态、审计标题、分析提示、操作前/后标题；`reports.ts` 漏斗不可用文案改为「转化路径只能在最近 90 天的精确统计范围内查看。」；17 首页货架 `canvas`→`img.community-thumbnail`。
8. 共用 `e2e-user` 在整轮里评论过多触发真实突发限流（5 分钟内 ≥5 条转人工）→ 拦截用例拿到 201。`testSeed.ts` 新增每浏览器 `e2e-comment-<browser>@example.com` 账号，14 的拦截用例改用它（已在 WebKit 重跑验证通过）。

E2E 非产品问题的测试侧处理：
- WebKit 在长页面滚动 + 指针刚移入后一两帧内命中测试用旧布局，mousedown 落到祖先、click 派发给共同祖先（React onClick 不触发）。`settledClick` 先悬停等两帧再点；15 的「重试确认保存」已改用。
- WebKit（Windows）Tab 不遍历链接、`taskkill /T` 偶发非零退出码：见 Verification 一节「测试基础设施」。14 的键盘用例失败发生在第一个 section（`comments`），与 `rules` 404 无关，但 `rules` 段也一并移除。

最终结果见 Verification 一节：三浏览器全量仅剩 chromium `13 手机 350px` 环境失败。

生产部署前置（人工事项）：
- 原图默认写入备份所用的私有桶 `COS_BUCKET` 的 `originals/` 前缀（`COS_*` 不齐全拒绝启动），`.env` 不需新增变量；到控制台确认该桶没有会命中 `originals/` 的自动删除生命周期规则——备份桶原先的「30 天自动删除」改为人工定期清理。想分桶再填可选的 `COS_ORIGINALS_BUCKET`。
- 开通腾讯云文本内容安全并配置 `TMS_*`（含 `TMS_BIZ_TYPE`）；缺失则评论全部待审并在系统信息页告警。
- 迁移 0013–0015 expand-only。

## Issues

见 `issues/01`–`issues/10`。
