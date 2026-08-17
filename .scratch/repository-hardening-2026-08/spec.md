# 豆谱全仓审查与全面整改 PRD

Status: ready-for-human

## Problem Statement

豆谱的普通 lint、typecheck、生产构建和 546 个单测虽然通过，但当前质量信号不可信：覆盖率门禁会被性能断言与 Argon2 原生并发干扰，E2E 辅助代码存在跨平台确定性缺陷，tag 发布绕过全部质量门禁，生产依赖仍有 high 漏洞。更严重的是，生成、保存、同步、认证、图片解码和导出各自存在可复现的数据一致性、算法正确性、事务和资源上界缺陷。

这些缺陷共享一个架构根因：重要不变量分散在调用方，module 的 interface 过浅，缺少可注入 seam。Workbench 同时管理源图、草稿、提交图纸、Worker 与持久化；引擎要求调用方记住过滤色板；同步依赖时间戳猜测因果；认证 route 直接串联多次写入。必须以深 module 收敛所有权，再用独立门禁证明正确性、性能和发布可靠性。

## Solution

一次性完成 13 个依赖有序的 P0–P2 tracer bullet。首先拆分可信质量门禁并迁移 Next.js 16/CSP nonce；随后建立生成会话 module，修复精确色彩、合并、采样和背景算法；再完成编辑、ProjectFile v2、revision 同步、认证事务、图片入口、导出、可访问 UI 与发布恢复链路。全部任务完成前不发布；最终要求零已知缺陷、零已知随机失败，且所有门禁可重复通过。

## User Stories

1. 作为开发者，我希望覆盖率、数据库集成和性能测试互不干扰，以便任一门禁失败时能准确定位原因。
2. 作为发布负责人，我希望 tag 与主分支复用同一套完整门禁，并校验版本单调，以免未验证或旧镜像覆盖 `latest`。
3. 作为站点用户，我希望调参、取消、恢复和导入时图纸、参数与色板始终属于同一提交版本，以免保存错误图纸。
4. 作为站点用户，我希望快速连续调参只计算最新任务，取消后 100ms 内停止进度和继续计算，以免页面卡顿和资源泄漏。
5. 作为拼豆用户，我希望五套内置色板和自定义色板的真实颜色精确映射到自身，所有合法格都有合法色号。
6. 作为照片用户，我希望主色、透明边缘和背景去除尊重覆盖权重与感知差异，以免肤色、渐变和贴边主体失真。
7. 作为编辑用户，我希望快速笔画连续、取消手势能回滚，并能搜索选择色板颜色；重生成前明确确认并可撤销。
8. 作为项目文件用户，我希望 v1 可导入但系统只写带 `engineVersion` 的 v2，一旦没有原图就锁定重生成控件并提示重新上传。
9. 作为登录用户，我希望保存后立即后台同步，并能区分本地与云端状态；双设备冲突时保留两份而不是静默覆盖。
10. 作为账号用户，我希望验证、重置和修改密码的多写状态转移是事务性的，失败不会烧毁令牌或遗留旧会话。
11. 作为手机用户，我希望合法大图不会在校验前耗尽内存，裁剪页也不会复制多个全尺寸缓冲。
12. 作为导出用户，我希望 500 色 PDF 和 200×1 极限 PNG 在全部现代浏览器中完整成功，或在编码前得到明确错误。
13. 作为键盘、触摸或辅助技术用户，我希望主要流程满足 WCAG 2.2 AA，Modal、画布和导航均可操作。
14. 作为运维人员，我希望备份只有在 dump 校验、压缩、上传和恢复验证后才算成功，迁移失败时不切换流量。

## Implementation Decisions

1. 生成会话固定为 `no-source / ready / generating / committed / failed / restored-locked`；保存和导出只读取 immutable committed snapshot。
2. Worker 为持久 adapter，只执行最新 job；取消使用协作检查点和任务代次，不把领域错误回退到主线程重复执行。
3. 引擎内部过滤不可用色；精确 Oklab 匹配按真实 24-bit RGB 缓存，不再使用 15-bit 近似选择。
4. 颜色合并用有限阈值穷举得到最小满足解，不能假设输出随阈值单调。
5. dominant 使用量化直方图与感知代表色；采样采用不重叠覆盖权重和 alpha 权重。
6. 自动背景使用角落共识和相对固定背景原型比较；提供手动背景取样，不让主体贴边自动成为 seed。
7. `ProjectFile v2` 增加 `engineVersion`，只保存一致的 `params + palette + pattern`，绝不保存原图。
8. v1 仅允许一次性导入迁移，之后只写 v2；数据库/API 使用短维护窗单向升级，不保留旧协议双写。
9. 设计和自定义色板增加单调 `revision`；更新携带 `baseRevision`，不匹配返回 409；冲突保留云端原件并创建显式本地冲突副本。
10. 列表采用 50 条游标分页；墓碑立即清除大型正文，仅保留同步元数据，90 天后硬删除；总行数/总字节配额在事务内执行。
11. 会话滚动 30 天、绝对上限 90 天，续期同时更新数据库与 Cookie。
12. Argon2 使用进程内并发闸门；请求滥用限流和实际邮件发送配额分开统计。
13. 所有 Route Handler 经统一异常 wrapper 输出 JSON 和 request ID；生产缺少邮件、备份或告警配置时拒绝启动，开发/测试使用显式 fake adapter。
14. 在完整 RGBA 解码前读取自然尺寸并校验；裁剪使用缩放预览；源图只传给 Worker 一次，所有 ImageBitmap 在每个出口关闭。
15. PDF 图例自动分页且配置按整组页面几何验证；PNG 图例换行并预检 Canvas 宽高/面积。
16. Next.js 16、ESLint CLI、默认 Turbopack 和官方 nonce 一次性迁移；新增 ADR 撤销 ADR-0007，接受全动态渲染，不保留 Next 15 兼容路径。
17. 统一响应式页头；Modal 具备焦点循环、恢复和背景 inert；颜色 token 满足 WCAG 2.2 AA。
18. 备份为原子 `dump → validate → compress → upload`，定期真实恢复；部署先迁移后切流。

## Testing Decisions

1. 每个行为按 TDD 完成：先在最高稳定 seam 写失败测试，再实现最小通过代码并重构。
2. 生成会话以 fake Worker adapter 验证 progress/cancel/result/latest-only；纯算法另用精确 oracle、属性测试、固定种子差分和 golden fixture。
3. 五套内置及自定义色板全部做精确色恒等；任何非透明合法格不得产生 `?`。
4. 合并算法对全部候选阈值穷举 oracle；随机小色板属性测试覆盖非单调情况。
5. 照片、像素画、肤色渐变、贴边主体、透明抗锯齿和真实 HEIC 均有 fixture；新旧输出需要人工并排验收。
6. 200×200、291 色冷启动小于 2 秒；取消后 100ms 内停止上报和计算；主线程无超过 50ms 长任务。
7. 同一 adapter contract 运行于 Fake、真实 Route/PGlite 和 PostgreSQL 16；覆盖双设备并发、冲突副本、离线重试、故障注入、配额竞态、墓碑清理。
8. PNG 解码后做像素/golden 断言；PDF 检查每个色号均位于可见页。
9. UI 覆盖 350/390/768/1280/1440px、axe、键盘、触摸、iOS Safari 和 Android Chrome。
10. 最终门禁包括 lint、typecheck、coverage、integration、performance、production build、Docker standalone、PostgreSQL 16 迁移、三浏览器 E2E、依赖审计和备份恢复。
11. coverage/performance 连续 5 次；三浏览器 E2E 关闭重试后连续 3 次；生产依赖 audit 为 0 critical/high。

## Out of Scope

- 不新增 AI、支付、深色模式、统计、模板库、多图拼版或其他与已确认缺陷无关的功能。
- 原图不进入项目文件、数据库或云端。
- 不保留 Next 15、旧 lint、旧 CSP、ProjectFile v1 写入或旧 revision-less API 的兼容分支。
- 不把人工真机验收伪装为自动化结果；缺少真机时必须明确列为发布阻塞。

## Further Notes

- 该 PRD 撤销 CONTEXT.md 中“全部优化已完成”的陈旧结论；本轮 13 张票全部完成并统一验收后才能再次标为完成。
- CSP 决策明确与 ADR-0007 冲突，将通过新 ADR 正式 supersede，而不是静默修改历史。
- 任务票按依赖顺序发布在 `issues/01` 至 `issues/13`；状态均为 `ready-for-agent`。
- 临时可视化架构报告：`$TMPDIR/architecture-review-20260817-121937.html`。
