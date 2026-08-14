# 20: E2E 测试套件

- Status: resolved
- Blocked by: 09, 10, 11, 12, 17

## 完成记录

- 基础设施：globalSetup/globalTeardown 启动 webpack dev 服务器（端口 3100）；dev 邮件假实现输出重定向到系统临时目录（避免 dev 文件监听触发 Fast Refresh）；DATABASE_URL 置空 → instrumentation 钩子初始化进程内 PGlite（免装 Postgres）；邮件链接经 URL 解析拼接基址。
- 用例 8 个 × 3 浏览器（chromium/firefox/webkit）= 24 例全绿：注册→验证→登录全旅程、登录防枚举、找回密码恒成功、工作台全流程（上传→裁剪→调参→悬停→编辑→撤销→PNG/PDF/项目文件导出→保存→刷新恢复）、E4 动图拒绝、E3 改名文本拒绝、E2 截断 PNG、E10 全透明图。
- 过程中修复真实跨浏览器缺陷：WebKit 的 createImageBitmap 不接受 options 参数、OffscreenCanvas 缺失 → 双层回退。
- 全量门禁：429 单测绿、lint 绿、build 绿（提交 5c5bf9e）。

## 目标

端到端测试：核心旅程 × 三浏览器 + 边界 fixture 用例，接入 CI。

## 范围

- 核心旅程（Chromium/Firefox/WebKit 各跑）：
  1. 注册→测试邮件钩子取验证链接→验证→登录；
  2. 上传 fixture 照片→裁剪（1:1）→调参→生成→悬停显示色号→编辑（画笔/橡皮/油漆桶/撤销）→导出 PNG/PDF/项目文件（断言文件下载与关键内容）→导入项目文件→保存；
  3. 第二浏览器上下文登录同账号→设计列表出现→打开→内容一致→修改→回第一上下文出现冲突提示（LWW）。
- 边界用例（Chromium）：E4 动图拒绝、E5 HEIC、E6 EXIF 方向、E2 损坏文件、E10 全透明、E7 1×1、E8 超大图拦截、E38 限额、E39 断网本地流程。
- 测试钩子：dev 邮件假实现输出读取；`E2E_SKIP_EMAIL=1` 等开关便于本地。
- CI：三浏览器并行；E2E 失败不合并。

## 不含

- 性能压测（引擎性能测试在 T05）。

## 规格引用

- spec §6、§8；ADR-0006。

## 验收标准

- [ ] 全部用例三浏览器通过（WebKit 下 HEIC 用例按浏览器能力分支）。
- [ ] CI 工作流 E2E 阶段全绿且时长可控（并行、产物归档）。
- [ ] 用例可重复运行（数据隔离：每用例独立账号/清库）。

## 完成记录

（resolve 时填写）
