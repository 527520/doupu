# ui-polish-2026 验证记录

日期：2026-09-08 · 基线 `b5c08e5` → 本轮 11 个本地提交（未推送）

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
  - `FormControls.test`：日期字段改点分段（真实落点）验证整块可点；月历开着再点不重复打开；点空白处同样打开。
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

## 第二轮 E2E：273 用例 · 239 通过 · 22 跳过 · 12 失败

第一轮的 27 个失败里 22 个已消失（含弹窗 / 菜单入场、17:187 抽屉误选、17:67 对位、webkit 429）。剩下 12 个按 trace 定位后的修法（第 10 个提交）：

| 失败用例 | 根因 | 修法 |
| --- | --- | --- |
| 03:57 8000×8000 上传主线程 73ms 长任务（chromium） | trace 对时：长任务落在解码完成后的首次 React 提交，不是裁剪弹窗打开。项目历史（site-visual-refinement）把这一提交压到 50ms 预算内，靠的是「没展示的东西不算」；这轮把高级选项从 `advancedOpen &&` 换成 `Disclosure` 后，折叠着的 4 个 NumberField、分段、开关都在首次提交里挂载了 | 折叠时不挂载高级选项内容（`{advancedOpen && …}`），恢复基线成本；展开动效不依赖内容预先存在 |
| 17:67 `/admin/batches` 350px axe 对比度（三浏览器）、17:126 首页 axe 对比度（chromium） | 列表错峰入场是从透明淡入的（`.stagger > *`），axe 在淡入中途抓到半透明文字（`#807a83` → `#e0dee1` 逐项变淡正是错峰序列）；令牌本身 `--color-ink-soft #68616C` 对白底 6.0:1 | E2E 17 新增 `settleMotion`：等页面上有限次动画 / 过渡跑完再跑 axe（无限循环的加载环不等）；全文件 6 处 axe 统一走 `axe(page, include?)` |
| 17:242 「发布日期」字段点本体不开月历（三浏览器） | react-aria 的 DateSegment / DateInput 自带 usePress，会在冒泡阶段截断 pointerdown / click，Group 上的普通 `onClick` 只有点空白处才收到；单测此前直接对 group 派发事件，是假阳性 | `useOpenOnFieldClick`：改在捕获阶段监听 `onClickCapture`，跳过右侧日历按钮（自带切换）与「按下时已打开」的点击；DatePicker / DateRangePicker 共用；单测改点分段，去掉修复即失败 |
| webkit 17:148 关闭抽屉后焦点没回到「更多筛选」 | 项目早前探针已确认：WebKit 鼠标点原生按钮不会给它焦点。基线这里是 react-aria Button，本轮换成了自家 `Button`（原生按钮）后，抽屉打开时 activeElement 是 body，关闭时无可恢复入口 | `begin` 里先 `event.currentTarget.focus()` 再开抽屉（与 site-ux 08 里「发布入口同步 focus()」同一做法） |
| webkit 17:170 色板「查看全部颜色」点了抽屉不开 | 与基线相比色板卡片只多了 hover 位移过渡；点击落点、水合状态（页面已加载完自定义色板空态）、控制台都正常，唯 react-aria 按钮的按压序列没有完成。相同卡片位移下原生按钮（设计卡片）在 WebKit 正常，问题限定在 usePress + 祖先位移过渡。机制没有 100% 证实 | 含控件的卡片 hover 只加深阴影不位移（`.palette-brand-card:hover` 去掉 `translateY`），位移只留给整卡即链接的卡片 |
| firefox 13:99 裁剪弹窗高度 700.000004 ≠ 700 | Firefox DOMRect 亚像素误差；弹窗面板不再有 transform（transform 会把图层吸附到整像素） | 断言改 `toBeCloseTo(height, 3)`，与文件里既有的「按 CSS 像素比较」注释一致 |
| firefox 02:12 取消生成后 UI 恢复 128.5ms > 100ms | 第一轮同一用例通过；测量包含 Worker 协作式取消的块边界延迟，Firefox 上本就贴着阈值。本轮唯一与之相关的改动（高级选项不再预挂载）只会让重渲染更轻 | 未改代码或阈值；请单独重跑几次确认是否为时序噪声：`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 npx playwright test tests/e2e/02-workbench-journey.spec.ts --project=firefox --repeat-each=3` |

## 第三轮 E2E：273 用例 · 244 通过 · 22 跳过 · 7 失败

第二轮的 12 个里，webkit 抽屉两项（17:148 / 17:170）、日期字段点本体、firefox 02 与 13 都已通过。剩下 7 个（第 11 个提交）：

| 失败用例 | 根因 | 修法 |
| --- | --- | --- |
| 03:57 长任务 53ms（chromium，上一轮 73ms） | 用 trace 截图帧对时：1212ms 时页面还是「正在生成图纸…」，1422ms 已是完整工作台，长任务落在 1283ms——就是**图纸落地的那次 React 提交**（预览画布 + 参数面板三个下拉 + 材料 / 导出面板一起挂载）。高级选项不再预挂载省了 20ms，但这次提交本来就贴着 50ms | `useGenerationSession` 把成功路径（`success` dispatch + `onSuccess` + 成功后的 `onSettled`）放进 `startTransition`：React 分片渲染、每 5ms 让出主线程，提交本身只剩 DOM 写入；`stateRef` 仍同步写入，取消 / 失败路径保持同步（取消后 100ms 的门禁不受影响） |
| 17:80 `/admin/users` 350px axe 对比度（chromium） | 还是错峰淡入被抓在半路：`settleMotion` 一次性 `await finished` 取样时列表还没到（异步请求），到了之后才开始淡入 | `settleMotion` 改轮询：有 `.skeleton` / `[aria-busy]` 视为「还在加载」，有正在跑的有限次动画视为「还在动」，直到静下来才跑 axe；首页「正在读取本机设计…」补 `aria-busy` |
| 17:80 users 与 17:255 audit 的筛选行底边不对齐（三浏览器） | 断言假设「搜索 / 日期区间 / 查询」能排成一行，但队列栏永远只有 370px 上下（截图里 1280 视口下左栏就这么宽），auto-fit 网格把三者排成了三行、查询按钮孤零零在第三行 | `FilterBar` 改两段式：第一段「搜索 + 查询」固定同一行（`minmax(0,1fr) auto`，底边对齐），第二段其余筛选各占一整行；断言同步改为「搜索与查询对齐、日期区间独占下一整行且左右与上一行对齐」 |

## 第四轮 E2E：273 用例 · 249 通过 · 22 跳过 · 2 失败

第三轮的 7 个里只剩 chromium 两条（第 12 个提交）：

| 失败用例 | 根因 | 修法 |
| --- | --- | --- |
| 03:57 长任务 54ms + 52ms（chromium） | 两条都在竖长图阶段：3432ms 是裁剪弹层打开后底下 2 万格预览被滚动条/布局挤一次重绘；3592ms 是第二次生成落地时桌面侧栏用 `hidden` 仍挂着导出，`createPngExportPlan` / `contentBounds` / `computeStats` 再扫一遍 2 万格，和 React 提交叠在一起。`startTransition` 只能分片，减不掉这些同步扫描 | 桌面导出与手机一致：没打开的面板不挂载；裁剪中 / 生成中 `PatternPreview` 暂停重绘，落地绘制改到下一帧；PDF 空图用已有 stats 判断，不再扫格子 |
| 16:46 首页五宽度 axe 对比度（chromium） | `.btn-primary` 上沿 `color-mix(..., 86%, #fff)` 把莓果加白，钉板落区主按钮 15px/600 白字对取样色 `#af6178` 只有 4.37:1 | 主按钮实心底锁 `--color-primary`，渐变只往 `--color-primary-deep` 走，不再加白；钉板 CTA 同样给不透明底色 |

## 第五轮 E2E：273 用例 · 246 通过 · 22 跳过 · 5 失败

第四轮的 16 对比度已过。剩下 5 条（第 13 个提交）：

| 失败用例 | 根因 | 修法 |
| --- | --- | --- |
| 02:12 取消时 `pngDisabled: false`（三浏览器） | 第四轮把桌面导出改成「没打开就不挂载」，MutationObserver 在 DOM 里找不到「下载 PNG」，`Boolean(undefined?.disabled)` 变成 false；宽度/保存锁定其实已经生效 | 导出按钮改回 `hidden=` 留在 DOM，生成中仍 `disabled`；`createPngExportPlan` 延后到打开选项，空图用 `patternHasPaintedCells` 提前返回，关闭时用整图尺寸做保守预检 |
| 03:57 方图阶段 52ms + 60ms 长任务（chromium） | 100×100 首次落地仍是上万次 `fillRect`；打开裁剪弹层时 `useMemo` 同步 `putImageData`，Retina 上还曾按 `dpr` 分配 1600² 缓冲 | 大图纸改 1px/格 ImageData 再放大，网格/板缝拆到下一帧；裁剪展示缓冲封顶 800，像素上传移出 render、放到 rAF |
| 06:154 350px 游客菜单项 < 44px | `.overflow-menu.is-open` 仍有 `menu-in`（translateY），按下还有 `scale(.985)`；子像素下量到不足 44 | 打开即终态，去掉菜单位移/缩放；菜单项 `min-height: 44px; flex-shrink: 0; transform: none` |

## 第六轮 E2E：273 用例 · 251 通过 · 22 跳过 · 0 失败

第五轮剩余 5 条已过（导出按钮留在 DOM、大图纸 ImageData 分帧绘制、裁剪缓冲封顶、菜单打开即终态）。全量 E2E 在用户终端跑通。复跑命令：

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
