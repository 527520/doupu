# ui-polish-2026 验证记录

日期：2026-09-08 · 基线 `b5c08e5` → 本轮 8 个本地提交（未推送）

## 已在本机通过

- `npx tsc --noEmit`：通过。
- `npx eslint .`：通过（React Compiler 的 preserve-manual-memoization 检查也通过；`Workbench` 的空白起稿摘要改为 `useMemo` 计算以满足它）。
- `npm test`（unit + serial + integration）：194 个文件、1550 个用例全部通过，13 个既有跳过。
  - 其中 `tests/unit/nextConfig.test.ts` 此前在没有「本地网络」权限的终端里会因 `os.networkInterfaces()` 抛 EPERM 而整文件失败；`next.config.ts` 现对该调用做了容错，测试通过。
- `npm run build`：生产构建通过。
- 新增 / 更新的单测：
  - `Button.test`：loading 渲染加载环且不进入可访问名称。
  - `FormControls.test`：日期字段整块可点（禁用时不打开）；SegmentedControl 写入 `--n`、轨道存在、`showLabel` / `size="sm"`。
  - `ActionOverflow.test`（新增）：豆粒触发器、↓/↑/Home/End 漫游、Esc 还焦、点击项后关闭并还焦。
  - `PatternPreview.test`：缩放按钮按可访问名查询；compact 变体用芯片、说明行与原图对位、提示只在 title。
  - `Workbench.test`：空白起稿改为「板数分段 + 摘要 + 创建空白图纸」；游客菜单项为统一菜单行。
  - `GenerationParamsPanel.test`：背景容差同时有滑杆与数字输入。
  - `DesignsView.test`：空态给出就近主按钮（页头 + 空态两处指向新建）。
  - 文案缩短后同步的名称：`确认调整 / 完整图纸 / 重置 / 重试确认 / 隐藏此版本 / 公开页 / 确认公开 / 释放并切换 / 打开图纸 / 撤回并修改 / 修改后重投 / 返回原图纸 / 撤销自动改动 / 应用到图纸 / 批量打标 / 恢复发布 / 确认下架 / 确认恢复 / 确认合并 / 提交审核 / 撤回审核 / 撤回作品 / 搜索记录`。

## 未能在本机执行（需要在你的终端里跑）

本次代理运行的沙箱里 Playwright 三种浏览器都无法启动（chromium / webkit 启动即 SIGSEGV，firefox 无法拉起进程），`next dev` 也因文件描述符上限（EMFILE）反复重启，所以 **E2E 与截图对照没有在本机完成**。请在你的终端执行：

```bash
# 若之前的冒烟服务器还占着端口，先清掉
lsof -ti:3200,3300 | xargs kill

# macOS 26 上 Playwright 1.62 会把主机判成 mac-x64，需要显式指定 arm64
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 npm run test:e2e
```

E2E 17（`tests/e2e/17-visual-refinement.spec.ts`）已扩展以下断言，截图会落到 `.scratch/ui-polish-2026/evidence/`：

- 审核台：图纸舞台与作者原图舞台顶边差 ≤ 2px；理由为空时「批准发布」禁用但 `opacity` 为 1；「返回列表」与左栏第一项在同一水平带（空态 / 详情靠顶）。
- 人员：搜索输入与「查询」同行且底边对齐（≤ 1px）。
- 豆社：排序分段滑块随选中位移（`::before` 的 transform 变化且 X 位移 > 0）；「发布日期」字段点本体即打开月历。
- 审计：搜索、日期区间、查询三者底边对齐。
- 空白起稿：存在唯一主按钮「创建空白图纸」；改板数只改摘要，不进入编辑；点创建后落在「编辑」页签；`#blank-start` axe 零违规。
- 原有断言全部保留：reduced-motion 下卡片 / 落区 hover 为恒等变换、落区拖入颜色、五宽度无溢出与 axe 零违规、字体加载、无 JS 降级、嵌套弹层焦点。

## 实现偏差（相对 spec）

- 溢出菜单没有改用 react-aria `Menu`：四处调用方与 E2E 03/04/06、SiteHeader / WorkbenchProjectBar 单测都依赖「子项是真实 `<a>` / `<button>`、面板 `data-testid=site-overflow-panel`、`onNavigate(event, href)` 离开保护」这一契约。保留 `ActionOverflow` 的子项模型，重做其表面（豆粒触发器、浮层 pop-in、44px 菜单项、危险语气、`<hr>` 分隔）并补方向键漫游。
- `CommunityMineActions` 的确认弹窗保留 `Modal`（它承载「结果未确认 → 重试同一请求」的状态机，Promise 化的 `useConfirm` 放不下），只把表面换成 `modal-title / modal-copy / modal-actions` 与 `Button dangerSolid`。
- 后台反馈没有引入全局 toast：`AdminCommandNotice` 改放在动作行正下方（处理完毕后落在详情面板顶部）并 `rise` 进场。
