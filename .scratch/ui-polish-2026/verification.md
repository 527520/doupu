# ui-polish-2026 验证记录

日期：2026-09-08 · 基线 `b5c08e5` → 本轮 9 个本地提交（未推送）

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
  - `ResponsiveSelect.test`：移动端抽屉里，打开触发器时的那次松手不会误选盖在指针下的选项；在选项上完整点一次才算选。
  - 文案缩短后同步的名称：`确认调整 / 完整图纸 / 重置 / 重试确认 / 隐藏此版本 / 公开页 / 确认公开 / 释放并切换 / 打开图纸 / 撤回并修改 / 修改后重投 / 返回原图纸 / 撤销自动改动 / 应用到图纸 / 批量打标 / 恢复发布 / 确认下架 / 确认恢复 / 确认合并 / 提交审核 / 撤回审核 / 撤回作品 / 搜索记录`。

## 第一轮 E2E（在你的终端跑的）：273 用例 · 224 通过 · 22 跳过 · 27 失败

22 个跳过是项目里既有的按浏览器条件跳过。27 个失败已按 trace 逐个定位，根因与修法如下（第 9 个提交 `fix(ui)`）：

| 失败用例 | 根因 | 修法 |
| --- | --- | --- |
| 05 裁剪拖拽（chromium / firefox）、15:90 弹窗底边 385.8 > 384、15:125 裁剪弹窗 axe 对比度、03:57 64ms 长任务 | 弹窗入场用了 `transform` / `opacity` / `backdrop-filter`，动画进行中的几何与合成结果被拿去做断言 | `.modal-backdrop` 只染底色（`backdrop-tint`），`.modal-panel` 只过渡阴影（`panel-settle`），裁剪弹窗与沉浸工作台不做入场动画；去掉 blur |
| 06:154 菜单项 < 44px | `.overflow-menu` 的 `pop-in` 带 `scale(.96)` | 改 `menu-in`（淡入 + 4px 下落，不缩放）；标签建议浮层同样改用 |
| webkit 17:148 / 17:170 DetailPanel 打不开、焦点不还 | 抽屉遮罩加了 blur 与 `[data-entering]` 动画 | 回退遮罩为纯底色 |
| 17:187 弹窗里下拉「不开」（三浏览器） | **不是动画问题**：trace 里颜色数从 `1 / 500` 跳成 `291 / 500`——下拉其实开了又立刻选中。RAC Select 是「按下即开、松手即选」，390px 下抽屉从底部盖住触发器位置，鼠标松开正压在「MARD · 291 色」上就被选走并复制进编辑器；选项高度从 48 改 44 后落点刚好换了一项。这是紧凑抽屉对鼠标用户的真实误触 bug，之前只是几何上侥幸 | `ResponsiveSelect` 紧凑档给 `ListBox` 传 `shouldSelectOnPressUp={false}`：只认选项自己的按压，打开那次松手不再算选择。新增单测「打开触发器时的那次松手不会误选盖在指针下的选项」（去掉修复会失败） |
| 17:242 `DOMMatrixReadOnly is not defined` | 在 Node 侧解析 transform 矩阵 | 改在浏览器里 `evaluate` 取 `m41` |
| 17:67 图纸与原图舞台 y 差 90px | 窄列里 compact 工具行折成两行，两侧三段各自独立 | `.review-material-pair` 外层三行轨道 + 两侧 `grid-template-rows: subgrid`，工具行折行时另一侧舞台一起下移；不支持 subgrid 的浏览器退化为各自三行 |
| webkit 一串 429（12:191、14:148、14:183、15:24 / 74 / 90、17:19） | 三个浏览器项目共用一个 PGlite 与同一 IP，豆社写接口默认 300/小时被批次原图上传耗尽 | `globalSetup` 放开 `RATE_COMMUNITY_WRITE_USER_HOUR / RATE_COMMUNITY_WRITE_IP_HOUR / RATE_PUBLIC_READ_IP_HOUR`（与已有 `RATE_LOGIN` 同一处，E2E 不验证限流本身） |

## 第二轮 E2E（需要在你的终端里再跑一次）

代理沙箱里浏览器进程起不来、`next dev` 因文件监听 EMFILE 反复自重启，**E2E 仍需在你的终端执行**：

```bash
# 若上一轮的 dev 服务器还占着端口，先清掉（E2E 用 3100；冒烟用 3200 / 3300）
lsof -ti:3100,3200,3300 | xargs kill

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
