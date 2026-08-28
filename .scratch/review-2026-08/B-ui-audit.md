# 轨道 B：UI/UX 审查与优化提案（豆谱 DouPu）

审查日期：2026-08-26 · 只读审查，未修改任何源文件 · 唯一新增文件为本报告
审查范围：`CONTEXT.md`、`src/app/globals.css`、`src/messages/zh-CN.ts`（全部文案）、`src/app/**/page.tsx`（11 个页面）、`src/components/**`（upload / crop / params / preview / editor / export / designs / palettes / account / auth / onboarding / layout / ui / system 全部 22 个组件）、`docs/screenshots/{home,workbench}.png`（实际读图）
不变约束（遵守）：D30「温柔治愈」视觉方向保留，仅做同风格内收敛；D7 仅中文；D8 手机可上传/查看/导出、精细编辑桌面优先。本报告不提议暗色/极简/工业风等替代方向。

---

## 摘要（最重要的 8 条）

1. **`--color-ink` 与 `--color-ink-soft` 是同一个值 `#4b4356`**（`globals.css:19-20`）。全站正文层级实际上被压平：标题、正文、次要标签、表单 label 全部同色，只有显式写 `/80`、`/60` 后缀的类才会被 `globals.css:114-118` 重映射到 `--color-ink-muted`。用户看到的是"一张纸上所有字一样重"的密集感，而这恰恰是"温柔治愈"最需要的呼吸层级。这是当前最高杠杆的一处修复（改 1 个 token 值）。

2. **`docs/screenshots/` 的两张截图仍是升级前的蓝色主题**（`home.png` 主按钮为 `#1a56db` 系蓝、白底、非圆体字；`workbench.png` 的「导出 PNG 图纸」是蓝色实心按钮）。README 首屏展示的就是这两张图 —— 新访客看到的第一印象与实际产品的粉紫奶油风完全不同，等于品牌资产失效。截图脚本 `docs/screenshots/capture.mjs` 存在，重跑即可。

3. **状态色系完全在 token 体系之外**：57 处 `text-red-*/bg-amber-*/text-green-*` 硬编码 Tailwind 默认调色板，分布 18 个文件（清单见 §3）。其中两处不满足 WCAG AA：`text-green-600 (#16a34a)` 在奶油底上仅 **3.13:1**（`SaveStatus.tsx:24` 的「已保存」、`AccountMenu.tsx:228` 的「已验证」），`text-amber-600 (#d97706)` 仅 **3.02:1**（`AccountMenu.tsx:230` 的「邮箱未验证」），且都用在 `text-xs` 上。用户在明亮环境的手机上会看不清最关键的"我的东西保存了没有"。

4. **生成完成没有任何完成反馈**（`Workbench.tsx:931-954` 的进度行在成功后直接消失，无 toast / 无 live region 播报 / 无焦点转移）。用户点了参数滑块 → 等 1-3 秒 → 图纸静默替换。这是整条主旅程里最值得投入的"记忆点"位置（提案见 §7.1）。

5. **色板管理页看不到颜色**（`app/palettes/page.tsx:172-181`）：五套内置色板各 291 色，卡片上只有品牌名 + 「291 色」文字；自定义色板编辑器（`PaletteEditor.tsx:230-270`）每行只有一个 hex 文本框，没有色块预览、没有取色器。对一个以颜色为核心的产品，这是最反直觉的一屏，也是第二个高价值记忆点位置。

6. **两处不可逆/破坏性操作用了原生 `window.confirm`**：重新生成会丢弃手工修补（`Workbench.tsx:445`）、删除自定义色板（`app/palettes/page.tsx:handleDelete`）、以及离开页面兜底（`Workbench.tsx:862`）。同一产品里删除设计、清除全部却用了品牌化 `Modal`（`DesignsView.tsx:365`、`PixelEditorCanvas.tsx:676`）。原生弹窗在手机上是系统灰底框，风格断裂且文案无法排版。

7. **移动端 350px 有 3 处确定的挤压**：工作台头部把「未登录：设计仅保存在本机浏览器，注册后可云端同步」（24 字）当作 `text-xs` 徽标塞进 `primaryActions`（`SaveStatus.tsx:21`），与「保存」按钮抢同一行；预览工具条把 9 个控件 + 一句 24 字操作提示放在单个 `flex-wrap` 行（`PatternPreview.tsx:198-209`）；编辑工具栏 14 个控件同理（`EditorToolbar.tsx:76-164`）。另外 `PatternPreview` 的 `touch-action: pan-x pan-y`（`PatternPreview.tsx:229`）**禁掉了双指缩放**，手机上只能点 ± 按钮看格子。

8. **6 条已写好的文案从未渲染**（死文案，说明对应的 UI 反馈缺失）：`workbench.stepUpload/stepCrop/stepWorkspace`（三步状态机没有步骤指示器）、`workbench.paletteLoadFailed`（云端自定义色板加载失败被静默吞掉，`Workbench.tsx:196-220` 的 `catch` 为空）、`designs.limitError`（存到第 101 个设计时无解释）、`designs.goRegister`（游客横幅只有"去登录"没有"注册"）、`home.guideStep1-3`、`upload.title`。

---

## 1. 问题清单

严重度：P0 阻断/数据感知错误 · P1 明显摩擦或无障碍不达标 · P2 一致性/打磨 · P3 可选增强
工作量：S ≤ 半天 · M 1-2 天 · L > 2 天

| # | 严重度 | 位置 | 用户可见问题 | 建议 | 工作量 | 需用户拍板 |
|---|---|---|---|---|---|---|
| B01 | P1 | `globals.css:19-20` | `ink` 与 `ink-soft` 同值 `#4b4356`，标题/正文/次要文字无层级，页面显得密不透风 | `--color-ink-soft: #6b6276`（奶油底 6.0:1，AA 通过），保留 `ink` 作标题 | S | 是（层级色值） |
| B02 | P1 | `SaveStatus.tsx:24`、`AccountMenu.tsx:228` | 「已保存」「已验证」绿字 `#16a34a` 在奶油底仅 3.13:1，`text-xs`，强光下看不清 | 新增 `--color-success: #2f7a52`（≈4.8:1）并统一引用 | S | 是（新增状态色 token） |
| B03 | P1 | `AccountMenu.tsx:230` | 「邮箱未验证」`#d97706` 仅 3.02:1，最需要被看见的警示反而最淡 | 新增 `--color-warning: #9a5b12` | S | 是（同上） |
| B04 | P1 | 18 个文件 57 处（§3 清单） | 成功/警告/错误在不同页面是不同的红/琥珀/绿，圆角也不同（`rounded`/`rounded-md`/`rounded-xl`），像多个产品拼起来 | 抽 4 个状态 token + 一个 `<Notice kind>` 组件类，逐处替换 | M | 是（是否引入 Notice 组件） |
| B05 | P1 | `Workbench.tsx:931-954` | 生成完成无任何反馈；参数一改，图纸静默替换，用户不确定"是不是我点漏了" | 完成时 live region 播报「已生成 100×100 · 6300 粒 · 34 色」+ 图纸淡入（§7.1） | M | 是（动效方案） |
| B06 | P1 | `PatternPreview.tsx:229` | 手机上无法双指缩放图纸看格子（`touch-action: pan-x pan-y` 排除 pinch），与编辑器的 `pinch-zoom` 不一致 | 改为 `pan-x pan-y pinch-zoom`，并补「适应宽度」按钮 | S | 否 |
| B07 | P1 | `Workbench.tsx:445`、`app/palettes/page.tsx` `handleDelete`、`PaletteEditor.tsx:132` | 破坏性确认用系统 `window.confirm`，灰底方框、无法排版，与站内 `Modal` 双轨 | 全部改用 `Modal`，与 `DesignsView` 删除弹窗同版式 | M | 否 |
| B08 | P1 | `Workbench.tsx:196-220` | 登录用户的云端自定义色板加载失败被静默吞掉，下拉里就是没有自己的色板，无从判断 | 渲染已有的 `workbench.paletteLoadFailed`，带「重试」 | S | 否 |
| B09 | P1 | `Workbench.tsx` 无 step 指示 | 上传→裁剪→工作台三步无进度指示，裁剪页只有「取消/使用整张图片/确认裁剪」，用户不知道后面还有几步、能不能回退 | 用已有 `workbench.stepUpload/stepCrop/stepWorkspace` 做 3 点式指示条 | M | 是（是否加步骤条） |
| B10 | P1 | `SaveStatus.tsx:21,25,27` | 整句错误当徽标：「本地存储空间不足，请导出项目文件备份后清理浏览器数据」挤在头部 `text-xs` 槽位；`unavailable` 同时出现在徽标和 `Workbench.tsx:957` 的整宽警示条，同一句话屏上出现两次 | 徽标只放 2-6 字状态词，长句下沉到警示条；去重 | S | 否 |
| B11 | P1 | `params/GenerationParamsPanel.tsx:130-200` | 「目标颜色数」「抖动」「取样模式」对新手是黑话；帮助页有解释但参数面板里没有任何入口 | 每个参数加一行 12px 的人话副标题（文案见 §6），抖动加 `?` 展开一句 | S | 是（副标题文案） |
| B12 | P1 | `app/palettes/page.tsx:172-181` | 色板管理页看不到任何颜色，291 色只以数字呈现 | 卡片加 291 色微色带 + 展开全色格（§7.2） | M | 是（展示形式） |
| B13 | P1 | `PaletteEditor.tsx:230-270` | 自定义色板逐行只有 hex 文本框，没有色块也没有取色器，需要脑内解码 `#RRGGBB` | 每行加 24px 色块（点击唤起 `<input type="color">`） | S | 否 |
| B14 | P2 | `page.tsx:38-52` vs `SiteHeader.tsx:44-60` | 首页导航与内页导航是两套代码两种尺寸（`px-4 py-2` vs `px-3 py-2`），首页无 `aria-current` | 首页复用 `SiteHeader` 或抽 `<SiteNav>` | S | 否 |
| B15 | P2 | `HomeAuthNav.tsx:81` | 登录主按钮手抄了一遍 `.btn-primary`（`py-2` 而非 `py-2.5`），与全站主按钮差 1px | 直接用 `className="btn-primary"` | S | 否 |
| B16 | P2 | `HomeAuthNav.tsx:69` | 「退出登录」hover 变 `bg-red-50/text-red-600`，全站唯一一处把退出当危险操作 | 改用中性 hover（`hover:bg-lilac-soft`） | S | 否 |
| B17 | P2 | `PngExportButton.tsx:106`、`PdfExportButton.tsx:101`、`EditorToolbar.tsx`、`PixelEditorCanvas.tsx:658` | 「选项/确认」面板一会儿是内联 `<section>`，一会儿是 `Modal`；导出区 3 个按钮 3 种视觉权重（实心/描边/描边），移动端要滚很远才看到 | 导出面板统一用 `Modal`；PNG/PDF 同级描边，只保留一个实心主操作 | M | 是（导出信息层级） |
| B18 | P2 | `globals.css:102` | `min-height:44px` 只覆盖 `button` 和 `[role=button]`，不含 `<a>`：首页导航链接 ≈36px、`DesignsView.tsx:249` 的「新建设计」`py-1.5` ≈30px；且只抬高度不抬宽度，`EditorToolbar` 的 ⇋⇵↺↻ 仍是 44×28 | 选择器加 `a[href]`，图标按钮加 `min-width:44px` | S | 否 |
| B19 | P2 | `PatternPreview.tsx:198-209` | 350px 下工具条 9 控件 + 24 字提示折成 4-5 行，把图纸挤到首屏外 | 提示折进 `?`；开关移动端折成一行三连胶囊 | M | 否 |
| B20 | P2 | `PixelEditorCanvas.tsx:237` | 键盘光标描边是 `#1d4ed8` 靛蓝，是全站唯一的蓝；`editor.cursorHint` 文案还写着「光标格有蓝色描边」 | 改 `--color-lilac-deep #765a9e`，文案改「紫色描边」 | S | 否 |
| B21 | P2 | `ImageCropper.tsx:192` | 裁剪手柄 `#3b82f6` 亮蓝，是裁剪页唯一的非品牌色，与旁边粉色按钮冲撞 | 改 `#b84f78`（主粉），白描边保留 | S | 否 |
| B22 | P2 | `EditorToolbar.tsx:64,70` | 无色/透明指示用 `#d1d5db` 冷灰，`draw.ts:33,37` 的"外部格"同样是 `#d1d5db` | 统一为 `--color-cream-deep #f6ede3` 系暖灰 | S | 否 |
| B23 | P2 | `Workbench.tsx:1036` | 悬停格信息渲染成图纸下方一条黑底 `bg-ink` 小条，视线要在图纸和条之间来回跳 | 跟随指针的浅色气泡（保留 `role=status`） | M | 否 |
| B24 | P2 | `login/page.tsx:25,53`、`register/page.tsx:27,54,57`、`forgot-password/page.tsx:30`、`reset-password/page.tsx:34,55` | 8 条中文错误文案硬编码在页面里，绕过 `zh-CN.ts`（该文件开头明确禁止），措辞与 `zh-CN.ts` 不一致 | 收进 `zhCN.authPages` | S | 否 |
| B25 | P2 | `help/page.tsx:52`、`about/page.tsx:71` | 「← 返回首页」是硬编码；`AuthShell.tsx:26` 同位置写「← 首页」，同一动作两个名字 | 统一 `zhCN.nav.home` | S | 否 |
| B26 | P2 | `home.uploadHint` vs `upload.hint`、`UploadDropzone.tsx:132` | 首页说「（支持拍照）」，工作台落点不说，且 `<input>` 没有 `capture` 属性，手机点开是文件选择器 —— 承诺与实现不一致 | 二选一：加 `capture="environment"` 或删掉承诺 | S | 是（是否做拍照） |
| B27 | P2 | `DesignsView.tsx:298` | 设计缩略图 `alt` 是固定的「图纸缩略图」，一屏 12 张全同名，读屏用户听不出区别 | `alt={design.name}` | S | 否 |
| B28 | P2 | `DesignsView.tsx:288-292`、`palettes/page.tsx:184-186` | 空状态只说"还没有"，`designs` 有下一步（「新建设计」），`palettes` 的「点击『新建色板』」按钮在页面顶部很远处 | 空状态内嵌主按钮 | S | 否 |
| B29 | P2 | `Workbench.tsx:1040` | 「编辑后将自动保存到本机」常驻在图纸下方，与头部保存徽标重复表达同一件事 | 只在首次编辑后短暂出现一次 | S | 否 |
| B30 | P3 | 全站 | 无任何动效（仅 `transition-colors duration-150`），也因此没有 `prefers-reduced-motion` 分支；一旦按 §7 加动效必须同时加 | 加动效同时补 `@media (prefers-reduced-motion: reduce)` | S | 否 |
| B31 | P3 | `PatternPreview.tsx` | 缩放只有 ±1.25 档，没有「适应宽度 / 100%」复位；缩到 300% 后回不到初始视图 | 加两个复位按钮 | S | 否 |
| B32 | P3 | `Modal.tsx:107` | 遮罩 `bg-black/30` 是纯黑透明，与奶油粉紫底一起发灰 | `rgb(75 67 86 / 0.32)`（墨紫透明） | S | 否 |
| B33 | P3 | `help/page.tsx`、`about/page.tsx` | 帮助/关于页的 `SiteHeader` 没有登录入口也没有 `AccountMenu`，从这两页无法进账号 | 传 `overflowActions={<AccountMenu/>}` | S | 否 |
| B34 | P3 | `help/page.tsx:39-49` | 12 条 FAQ 全部展开成 12 张卡片，一屏读不完也搜不到 | 用 `<details>` 折叠 + 分组（上传/参数/导出/账号） | M | 否 |
| B35 | P3 | `PatternPreview.tsx:222`、`PixelEditorCanvas.tsx:662` | 两个 `<canvas>` 都只有 `aria-label`，读屏用户拿不到任何图纸内容 | 补 `<figcaption>` 式摘要：尺寸/粒数/前 5 色号占比 | M | 否 |
| B36 | P3 | `OnboardingGuide.tsx:69-77` | 关闭按钮「我知道了」在标题行右侧、与主行动「开始制作」争夺注意 | 关闭降级为 `×` 图标按钮（`aria-label` 保留文案） | S | 否 |


---

## 2. 设计 token 现状盘点

### 2.1 已定义 token（`src/app/globals.css` `@theme`，行 8-36）

| token | 值 | 行 | 实际使用情况 |
|---|---|---|---|
| `--color-cream` | `#fdf8f4` | 10 | 页面底色，`body` + 各 `main` 重复写 `bg-cream`（`page.tsx:11`、`app/page.tsx:8`、`AuthShell.tsx:14`、`not-found.tsx:9`、`error.tsx:26`）；`body` 已设，5 处重复 |
| `--color-cream-deep` | `#f6ede3` | 11 | 仅 3 处：画布容器 `bg-cream-deep/60`（预览/编辑）、设计缩略图槽 `bg-cream-deep/70` |
| `--color-primary` | `#b84f78` | 14 | 主按钮、选中态、focus ring。白字对比 **4.74:1** ✓ AA |
| `--color-primary-deep` | `#ad3f6d` | 15 | hover、链接文字。奶油底 **5.37:1** ✓ |
| `--color-primary-soft` | `#fbeaf0` | 16 | hover 底、`::selection`、导航当前项 |
| `--color-ink` | `#4b4356` | 19 | 标题/正文。奶油底 **8.91:1** ✓ |
| `--color-ink-soft` | `#4b4356` | 20 | **与 `ink` 完全相同 → 层级失效**（B01）。被 47 处 `text-ink-soft` 使用 |
| `--color-ink-muted` | `#61586c` | 21 | 不被直接使用，只通过 `globals.css:114-118` 的 `[class~='text-ink-soft/80']` 属性选择器间接生效。奶油底 **6.38:1** ✓ |
| `--color-lilac` | `#8b75b4` | 24 | 描边、分隔线。白底 3.96:1（够描边不够正文，现状未违规） |
| `--color-lilac-deep` | `#765a9e` | 25 | 仅 1 处：`SiteHeader.tsx` 的 `/` 分隔符（`aria-hidden`） |
| `--color-lilac-soft` | `#f0eaf8` | 26 | 次级 hover 底、徽标底。与 `ink` 7.97:1 ✓ |
| `--shadow-soft` | `0 8px 24px -10px rgb(232 133 168 / .45)` | 29 | 主按钮、弹窗、导出面板 |
| `--shadow-card` | `0 2px 14px -6px rgb(75 67 86 / .14)` | 30 | `.card-surface`、首页落点 |
| `--font-sans` | Yuanti SC → YouYuan → PingFang SC → … | 33-35 | 中文圆体依赖本机字体，Windows 上 `YouYuan`（幼圆）多数机型有，Android 无 → **移动端多数用户看到的是默认非圆体**；无 web font 兜底 |

**缺口**：无字号 token、无间距 token、无圆角 token、无状态色（成功/警告/危险/信息）、无动效时长/曲线 token、无层级 z-index token（现状 `z-20` 面板 / `z-30` 弹窗写死在组件里）。

### 2.2 已定义组件类（`globals.css` `@layer components`，行 67-93）与其被绕过的次数

| 组件类 | 定义行 | 正确使用 | 被手抄/绕过 |
|---|---|---|---|
| `.btn-primary` | 68-70 | `login/register/forgot/reset/verify` 页、`crop` 确认、`not-found`、`error`、`OnboardingGuide.tsx:79` | **8 处手写等价物**：`HomeAuthNav.tsx:81`、`DesignsView.tsx:249`、`palettes/page.tsx:127`、`PngExportButton.tsx:84` 与 `:129`、`PdfExportButton.tsx:118`、`PaletteEditor.tsx:213` 与 `:290`、`AccountMenu.tsx:118`、`DesignsView.tsx:352`。尺寸各不相同（`py-1` / `py-1.5` / `py-2` / `py-2.5`） |
| `.btn-outline` | 72-74 | `crop` 取消、`SiteHeader.tsx:88` 菜单、`Workbench.tsx:924` 重新上传、`not-found`、`error` | **12 处手写 `rounded-full border border-lilac/50 px-2/3 py-1`**：`SaveStatus.tsx:34`、`PdfExportButton.tsx:83`、`ProjectFileButtons.tsx:73,81`、`PaletteEditor.tsx:161,164,167,283`、`AccountMenu.tsx:112,192,246,253`、`DesignsView.tsx:275,325,331,348`、`PixelEditorCanvas.tsx:679`、`Workbench.tsx:1044` |
| `.input-field` | 76-78 | 5 个认证页、`AccountMenu` 三个密码框、`DesignsView.tsx:359` 重命名 | **8 处手写 `rounded-lg border border-lilac/50 px-2 py-1`**：`GenerationParamsPanel.tsx:151,181,207,225`、`DesignNameEditor.tsx:22`、`PixelEditorCanvas.tsx:627,643`、`PaletteEditor.tsx:150,242,253`、`AccountMenu.tsx:243`。字号从 `text-xs` 到 `text-sm` 不等，高度 26px~42px 不等 |
| `.card-surface` | 80-81 | `Workbench` 统计卡/导出卡、`GenerationParamsPanel.tsx:135`、`DesignsView` 设计卡、`palettes` 卡、`help` FAQ 卡、`AuthShell`、`OnboardingGuide` | **6 处手写 `rounded-2xl border border-lilac/40 bg-white`**：`PngExportButton.tsx:106`、`PdfExportButton.tsx:101`、`SiteHeader.tsx:96`、`PixelEditorCanvas.tsx:610`、`Modal.tsx:118`、`PatternPreview.tsx:220` |
| `.link-soft` | 84 | 广泛使用 ✓ | 3 处手写 `underline underline-offset-*`：`register/page.tsx:73`、`forgot-password/page.tsx:65`、`DesignsView.tsx:261` |
| `.page-title` | 88 | **0 处使用**（死类）。各页面各写一遍：`page.tsx:14` `text-5xl`、`AuthShell.tsx:22` `text-2xl`、`not-found.tsx:13` `text-2xl`、`SiteHeader.tsx:70` `text-lg`、`ImageCropper.tsx:436` `text-lg` |
| `.site-header` | 91-92 | `SiteHeader.tsx:64` ✓ | — |

### 2.3 硬编码偏离清单

**(a) 圆角 —— 8 种半径混用（130 处 `rounded-*`，25 个文件）**

| 半径 | 出现位置举例 | 问题 |
|---|---|---|
| `rounded`（4px） | `UploadDropzone.tsx:148` 重试按钮、`EditorToolbar.tsx:161` 清除全部、`PaletteEditor.tsx:260` 删除行、`DesignsView.tsx:378` 删除确认按钮、`AccountMenu.tsx:253` 注销账号 | **全部集中在危险操作上**：同一产品里"危险"被表达为"方角"，与圆润基调冲突，且其他危险按钮（`PixelEditorCanvas.tsx:683`、`AccountMenu.tsx:159`）却是 `rounded-full` |
| `rounded-md` | `UploadDropzone.tsx:143` 错误条 | 全站唯一一处，其余错误条都是 `rounded-xl` |
| `rounded-sm` | 各处 3×3 / 4×4 色块 | 合理（小色块） |
| `rounded-lg` | 数字输入、下拉、悬停信息条 | 合理 |
| `rounded-xl` | 所有警示/状态条、编辑器面板 | 合理，但与 `rounded-md`、`rounded` 的错误条不统一 |
| `rounded-2xl` | 卡片、弹窗、画布容器 | 合理 |
| `rounded-3xl` | `page.tsx:24` 首页落点、`UploadDropzone.tsx:126`、`DesignsView.tsx:289` 空状态 | 合理（大面积虚线容器） |
| `rounded-full` | 按钮、徽标、页签 | 合理 |
| `rounded-none` | `ImageCropper.tsx:465` | **有意为之且有注释**（圆角会裁掉角点命中区），保留 |

**(b) 状态色 —— 57 处硬编码 Tailwind 默认色，18 个文件**

| 文件:行 | 类 | 语义 |
|---|---|---|
| `SaveStatus.tsx:22,24,25,26,27` | `text-amber-700` / `text-green-600` / `text-red-600`×3 | 未保存 / 已保存 / 配额·失败·不可用 |
| `Workbench.tsx:957,962,967,1054` | `amber-200/50/800`、`red-200/50/700`、`amber-200/50/900`、`amber-300/50/900` | 存储不可用 / 错误 / 同步提示 / 需重新上传。**四条警示条三种琥珀配方** |
| `DesignsView.tsx:266,281,283,316,317` | `amber-*`、`red-*`、`green-100/700`、`amber-100/700` | 冲突横幅 / 错误 / 重试 / 已同步 / 未同步 |
| `DesignsView.tsx:334,378` | `border-red-300 text-red-600`、`bg-red-600` | 删除按钮 / 删除确认 |
| `AccountMenu.tsx:89,140,151,159,228,230,253` | `red-600/700`、`green-600`、`amber-600` | 表单错误 / 注销标题 / 注销按钮 / 已验证 / 未验证 |
| `palettes/page.tsx:138,140,147,190` | `red-200/50/700`、`red-300`、`amber-200/50/800`、`text-red-600` | 页错误 / 重试 / 需登录 / 删除 |
| `PaletteEditor.tsx:156,199,233,260,265` | `text-red-600`×4、`bg-red-50` 行底 | 校验错误 |
| `PixelEditorCanvas.tsx:676,677,683` | `border-red-200`、`text-red-700`、`bg-red-600` | 清除全部确认弹窗 |
| `EditorToolbar.tsx:161` | `border-red-200 text-red-600` | 清除全部 |
| `UploadDropzone.tsx:143,148` | `bg-red-50 text-red-700`、`border-red-300` | 上传错误 + 重试 |
| `FormError.tsx:7` | `bg-red-50 text-red-700` | 认证表单错误 |
| `PngExportButton.tsx:97`、`PdfExportButton.tsx:96,107`、`ProjectFileButtons.tsx:95` | `text-red-600` / `red-200/50/700` | 导出错误 |
| `forgot-password/page.tsx:58,61`、`verify-email/page.tsx:94,123`、`register/page.tsx:68`、`reset-password/page.tsx:66` | `bg-red-50`、`bg-green-50 text-green-700`、`text-green-700` | 错误 / 成功 |
| `HomeAuthNav.tsx:69` | `hover:bg-red-50 hover:text-red-600` | 退出登录（唯一被当作危险的退出） |

**(c) 硬编码 hex（canvas 绘制层，无法走 Tailwind token，但可读 CSS 变量）**

| 文件:行 | 值 | 用途 | 问题 |
|---|---|---|---|
| `PixelEditorCanvas.tsx:237` | `#1d4ed8` | 键盘光标内描边 | 全站唯一靛蓝；`editor.cursorHint` 文案也写死「蓝色描边」 |
| `PixelEditorCanvas.tsx:234,241` | `#ffffff` | 光标外描边/十字 | 合理（保证任意底色可见） |
| `ImageCropper.tsx:192` | `#3b82f6` | 8 个裁剪手柄 | 亮蓝，与同屏粉色按钮冲撞 |
| `ImageCropper.tsx:187` | `#ffffff` + `rgba(0,0,0,0.5)` 遮罩 | 选框 | 遮罩纯黑，建议墨紫 `rgb(75 67 86 / .5)` |
| `EditorToolbar.tsx:64,70` | `#d1d5db`、`#ffffff` | 无色指示 + 透明棋盘格 | 冷灰，与暖奶油底不搭 |
| `lib/render/draw.ts:33,37` | `#d1d5db` | 外部格默认色 | 同上 |
| `lib/render/draw.ts:51,67` | `rgba(0,0,0,0.18)` / `0.55` | 网格线 / 板缝线 | 纯黑网格是图纸清晰度所需，可保留；建议改 `rgb(75 67 86 / .2)` 与 `/.6` 保持一致调性 |
| `Modal.tsx:107` | `bg-black/30` | 弹窗遮罩 | 建议墨紫透明 |

**(d) 字号 —— 无 token，10 级混用**
`text-xs`(45 处) / `text-sm`(80+ 处) / `text-base`(默认) / `text-lg`(6) / `text-xl`(1) / `text-2xl`(4) / `text-5xl`(1) / `text-6xl`(1) / `text-7xl`(2)。同类元素不同字号的具体例子：卡片内小标题在 `PngExportButton.tsx:107` 是 `text-sm font-medium`（且无 `text-ink`，继承 body 色）、在 `DesignsView.tsx:357` 是 `text-sm font-medium text-ink`、在 `PixelEditorCanvas.tsx:677` 是 `text-sm font-medium text-red-700`；徽标在 `DesignsView.tsx:314-318` 是 `text-xs`、在 `SaveStatus.tsx:31` 也是 `text-xs` 但字色体系不同。

**(e) 间距** —— 页面容器三种：`max-w-6xl p-4`（工作台、设计）、`max-w-5xl p-4`（色板）、`max-w-3xl px-6 py-10`（帮助、关于）、`max-w-md`（认证卡）。栏距 `gap-4`/`gap-6`/`gap-8`/`gap-10` 混用，无 token。


---

## 3. 关键旅程逐步走查

### 步骤 1 · 首页（`src/app/page.tsx`）

- **主张偏弱**：`app.tagline`「上传照片，生成拼豆图纸」是功能描述而非价值主张，紧接着 `app.description` 又把同样的信息用更长的句子说第二遍（`page.tsx:16-17`）。首屏三段文字都在说"这是个什么工具"，没有一句说"你会得到什么"。
- **落点不是真落点**：首页的上传框（`page.tsx:22-27`）是一个 `<Link href="/app">`，长得像可拖拽的虚线落区（`border-2 border-dashed`），但**拖图片进去不会有反应**，只能点击跳转。用户拖了一张图上去，什么都不发生 —— 这是最容易发生的第一次失败。
- **导航像列表而不像层级**：`page.tsx:38-52` 把「工作台/我的设计/色板管理/帮助/关于」+ 登录按钮平铺成一排等重胶囊。新用户的下一步应该是"上传"，但视线里 6 个同等选项。
- 引导卡（`OnboardingGuide.tsx`）只对游客且未关闭时显示，关闭后 localStorage 永久隐藏，帮助页没有"再看一次三步上手"的入口。

### 步骤 2 · 上传（`components/upload/UploadDropzone.tsx`）

- 反馈链完整：`reading` → 校验失败 `role="alert"` + 「重新选择」（`:143-151`）。8 条错误码文案都说清了原因与动作 ✓。
- 但**错误条样式是全站孤例**（`rounded-md bg-red-50`，其余错误条是 `rounded-xl border border-red-200`），且重试按钮是 `rounded`（4px 方角）。
- `formatHint`「支持 JPEG / PNG / WebP / HEIC，最大 20 MB」只在落区内小字，触发错误后（`:135` 三元分支）提示区被 `reading` 文案替换，用户看不到限制说明。
- 首页承诺「（支持拍照）」，但 `<input>`（`:132-140`）没有 `capture` 属性（B26）。
- 没有取消入口：大文件 `FileReader` 读取期间（`reading` 态）无法取消，落区变成不可点的文字。

### 步骤 3 · 裁剪（`components/crop/ImageCropper.tsx`）

- 交互实现相当完整：四角/四边手柄、触屏热区放大到 30px、`clampPointer` 防跳变、方向键微调、`pointercancel` 清理 ✓。
- **三个按钮无主次可辨**（`:479-497`）：「取消」`btn-outline`、「使用整张图片」`btn-outline`、「确认裁剪」`btn-primary`。「使用整张图片」是最常用的跳过路径，却和「取消」长得一样，右对齐排在中间 —— 用户容易点错到取消，回到上传页要重选文件。
- **操作提示手机上完全不显示**：`:471` 的 `hidden sm:block` 让「拖动选框移动…」「方向键微调…」在 <640px 隐藏。手机用户面对一个全图选区，不知道可以拖动改选区。
- 手柄 `#3b82f6` 亮蓝（B21）。
- 无"重置选区"按钮；乱拖之后只能取消重来。

### 步骤 4 · 调参（`components/params/GenerationParamsPanel.tsx`）

- 结构合理：核心三项（宽度/颜色数/抖动）+ 品牌 + 折叠高级 ✓；滑块 + 数字框双通道，非法值在 `onBlur` 回退到合法值（`:97-113`）✓。
- **术语无解释**（B11）：「目标颜色数（2–128）」「抖动」「取样模式：主色（卡通）/ 平均色（真实）」「背景容差」。帮助页 `help.paramsBody` 有很好的解释、`help.faqs` 甚至有"宽度选多少合适 / 颜色数选多少合适"两条，但参数面板里没有任何链接过去。
- **非法值静默回退**：输入 300 → 失焦 → 变回 100，`params.invalidWidth`/`invalidColors` 两条文案存在但**从未渲染**（面板里搜不到引用）。用户以为输入没生效。
- 「高级选项」是一个 `link-soft` 文字按钮（`:229-236`），有 `aria-expanded` 但没有 ▾ 指示符，看不出是可展开的。
- 背景取样画布（`:280-289`）只在勾选"手动指定背景色"后出现，是唯一能看到原图的地方 —— 生成后原图就再也看不见了，无法比对。
- 改任一参数触发 300ms 防抖后**立刻重新生成**，若已有手工修补则弹原生 `confirm`（B07）。频繁拖滑块 = 频繁弹窗。

### 步骤 5 · 生成（`Workbench.tsx:931-954`）

- 进度处理很扎实：>300ms 才显示进度条、固定宽度槽位防按钮跳动、可取消并回滚到上次稳定态 ✓。
- **完成时零反馈**（B05）：进度行消失、图纸替换，没有播报、没有动效、焦点不动。
- `t.generating` = 「正在生成图纸…（可继续调整参数，以最后一次为准）」把机制解释塞进状态句。
- 「取消」是一个下划线文字链（`:946-952`），在 `text-primary-deep` 的整行里视觉权重最低，却是这一刻唯一的可点操作。
- 失败文案「图纸生成失败，请重试。」没说可能原因（图太大？色板为空？）也没有重试按钮，用户得自己再动一次滑块。

### 步骤 6 · 编辑（`components/editor/PixelEditorCanvas.tsx` + `EditorToolbar.tsx`）

- 键盘可达做得很好：`tabIndex=0` 的容器、方向键移动光标 + 回车落笔、B/E/G/I 快捷键、Ctrl+Z/Y、`aria-describedby` 指向实时状态行（`:667-674`）✓。
- **工具发现性差**：`EditorToolbar.tsx:76-164` 是 14 个纯文字/符号按钮的等重平铺（当前色 → 画笔 橡皮 油漆桶 吸管 → 画笔大小 → 撤销 重做 → 颜色替换 → ⇋ ⇵ ↺ ↻ → 清除全部）。四个变换按钮只有 Unicode 箭头 + `title`（`:145-158`），触屏没有 hover 无法看 tooltip，用户不知道 ⇋ 是左右翻转。
- **快捷键无处可查**：`TOOL_SHORTCUTS`（`:34-42`）只出现在 `title` 里；帮助页没有快捷键表。
- 「颜色替换」是页签外的内联表单（`:620-655`），且 `onToolChange` 里 `replace` 会 toggle 面板（`:585`）—— 点"颜色替换"工具按钮和点面板入口是两条路径通向同一个 UI。
- 「原色号」是**自由文本输入**（`:625-631`）：用户要手打 `D20`，打错了得到「图中没有该色号，未做任何修改」。旁边的「替换为」却是下拉。同一表单两种输入范式。
- 「清除全部」确认弹窗做得对（`Modal` + 说明可撤销）✓，但入口按钮是方角红框（B「危险=方角」孤例）。
- 色板托盘 `max-h-28 overflow-auto`（`:610-617`）：291 色在 112px 高的内嵌滚动区里翻，页面本身也在滚 —— 移动端双层滚动。搜索框有 ✓。
- 桌面优先符合 D8，但移动端进入「编辑」页签没有任何"此功能建议在电脑上使用"的说明。

### 步骤 7 · 导出（`components/export/*`）

- 三个入口叠在一张卡里（`Workbench.tsx:1080-1104`）：「导出 PNG 图纸」实心粉、「导出 PDF」描边、「导出项目文件 / 导入项目文件」并排描边。**导入项目文件和导出并列**，是一个语义完全不同的操作被塞进导出卡。
- PNG 选项面板是内联展开的 `<section>`（`PngExportButton.tsx:106`），PDF 确认面板也是内联 `<section>`（`PdfExportButton.tsx:101`），而清除全部/删除设计是 `Modal` —— 同类"确认"体验双轨（B17）。
- PDF 面板信息很好：「共 N 页：图纸 X 页 + 图例清单 Y 页」+ >10 页时提示耗时 ✓。
- PNG 选项术语偏内部：「格子大小 8/16/24/32/48px」对用户意味着什么（打印尺寸？文件大小？）没有说明；「裁掉图纸边缘空白」不知道会不会影响拼装对齐。
- 导出成功后**无任何确认**：浏览器下载条是唯一反馈。在 iOS Safari 上下载行为不明显，用户可能反复点。
- `export.pngFailed` = 「导出失败，请重试。」不说原因（图纸太大？内存不足？）。

### 步骤 8 · 保存 / 登录（`SaveStatus.tsx`、`AuthShell` 系列）

- 自动保存 1s 防抖 + 手动保存 + `beforeunload` 兜底 ✓；本地优先、云端异步，是正确的模型。
- **状态词过载**：头部同时可出现「本地：已保存」+「云端：已同步」两条 `text-xs` 状态 + 「保存」按钮 + 设计名输入框 + 色板名。用户要读 5 个信息才知道"我的东西安全吗"。
- **未登录提示是整句挤在徽标位**（B10）。
- 「保存」按钮在自动保存已生效时依然常驻且是描边样式（`SaveStatus.tsx:34`）—— 既不像必须点，又不能确定不点会不会丢。
- 冲突文案是本报告里写得最好的一条：`syncConflictCopy`「检测到其他设备的更新：云端原件已保留，当前修改已切换到本地冲突副本。」说清了发生什么 ✓；但呈现为琥珀 `role="status"` 条（`Workbench.tsx:967`），与"存储不可用"用同一种琥珀，严重度无法区分。
- 认证页 `AuthShell` 干净统一 ✓；但**登录页没有"为什么要登录"的说明** —— 从工作台点"登录"过来，用户不知道登录后能得到"换设备继续编辑"。`designs.guestBanner` 说了这句话，登录页没说。
- 注册成功页（`register/page.tsx:66-84`）绿字 + 「前往登录」链接；`registeredSent` 说了要查收邮件 ✓，但没说"没收到怎么办"（重发入口在 `/verify-email` 失败分支里，此处无链接）。

---

## 4. 移动端专节

### 350px（小屏 Android / iPhone SE 竖屏）

| 位置 | 具体问题 |
|---|---|
| `SiteHeader.tsx:66-100` | 第一行：`豆谱` + `/` + 标题(truncate) + 「菜单与账户」按钮。`btn-outline px-3 py-2 text-xs` 的「菜单与账户」5 个字 ≈70px，加上 `豆谱`+`/`+`工作台` ≈100px，勉强一行。第二行 `context` + `primaryActions` 在 `sm:` 以下是 `flex-col`，所以设计名输入（`w-44` = 176px 固定宽）+ 色板名 + 保存状态区各占一行 → 头部高度约 200px，首屏一半被头部吃掉。 |
| `SaveStatus.tsx:21` | 「未登录：设计仅保存在本机浏览器，注册后可云端同步」24 字 `text-xs` ≈ 290px → 换行两行；`quota` 态的 25 字同理。徽标区高度不可控。 |
| `PatternPreview.tsx:198-209` | 单个 `flex-wrap` 行内 9 个元素：−、100%、+、3 个复选框（各带 2-3 字标签）、24 字 `panHint`。350px 下折成 4-5 行 ≈120px，图纸被推到首屏外。 |
| `EditorToolbar.tsx:76-164` | 14 个控件 + 分隔线，350px 下约 6 行 ≈180px。加上色板托盘 112px + 搜索框，编辑画布出现在 ~450px 处。 |
| `Workbench.tsx:1072` | 统计列表 `max-h-40 overflow-auto` 与页面滚动嵌套；`PixelEditorCanvas.tsx:610` 的 `max-h-28 overflow-auto` 同理。移动端触屏在内嵌区滚动容易"卡住"页面滚动。 |
| `ImageCropper.tsx:471` | `hidden sm:block` → 裁剪操作提示在手机上完全消失。 |
| `DesignsView.tsx:307-337` | 设计卡 `grid-cols-2`，每卡内含缩略图 + 名称 + 尺寸 + 时间 + 2-3 个徽标 + 3 个按钮（打开/重命名/删除，`text-xs px-2 py-1`）。350px 下单卡宽 ≈160px，三个按钮 `flex-wrap` 折成 2 行，删除按钮宽约 44px 高 44px（coarse 规则抬升）但相邻间距仅 `gap-1`=4px → 误触删除风险。 |
| `AccountMenu.tsx:232-250` | 未验证态：提示文字 + 邮箱输入 `w-full sm:w-40` + 重发按钮，在 `overflowActions` 面板（`min-w-56` = 224px）里，输入框满宽后按钮换行，面板高度接近 200px。 |

### 390px（iPhone 14/15 竖屏）
上述问题同样存在，仅换行位置不同。`SiteHeader` 第一行不换行，`PatternPreview` 工具条折 3-4 行。

### 768px（iPad 竖屏 / 折叠屏展开）

- 关键断层：`Workbench.tsx:979` 用 `lg:grid-cols-[1fr_320px]`（`lg` = 1024px）。**768–1023px 区间参数面板、统计、导出全部堆在图纸下方**，而这个宽度完全放得下 `[1fr_260px]`。iPad 竖屏用户调一次参数要上下滚一个屏幕高度。建议增加 `md:grid-cols-[1fr_280px]` 断点。
- `DesignsView.tsx:305` `sm:grid-cols-3 lg:grid-cols-4` → 768px 是 3 列，卡片宽 ≈230px，够用 ✓。
- `SiteHeader` 在 `md`(768px) 起显示完整导航 ✓，切换点合理。

### 触控目标（<44px 清单）

| 元素 | 实际尺寸 | 位置 |
|---|---|---|
| 变换按钮 ⇋ ⇵ ↺ ↻ | 高 44（coarse 规则）× 宽 ≈28 | `EditorToolbar.tsx:145-158` |
| 缩放 − / + | 高 44 × 宽 ≈28 | `PatternPreview.tsx:200,205` |
| 画笔大小 1×1/2×2/3×3 | `min-w-7` = 28px 宽 | `EditorToolbar.tsx:114-124` |
| 删除行 `×` | ≈26×44 | `PaletteEditor.tsx:255-262` |
| 三个预览复选框 | 原生 checkbox ≈16px（label 含文字，实际热区较大但复选框本体小） | `PatternPreview.tsx:41-44` |
| 首页导航链接 | `py-2` ≈36px 高（`<a>` 不受 `globals.css:102` 覆盖） | `page.tsx:44-49` |
| 「新建设计」 | `py-1.5` ≈30px 高（`<a>`） | `DesignsView.tsx:249` |
| 编辑/预览页签 | `py-1` + coarse → 44 高 ✓，宽 ≈52 ✓ | `Workbench.tsx:990,1005` |

### canvas 手势

| 画布 | `touch-action` | 结果 |
|---|---|---|
| 预览 | `pan-x pan-y`（`PatternPreview.tsx:229`） | **双指缩放被禁**，且长按 500ms 才出格信息、`onPointerMove` 立刻取消长按定时器（`:264-270`）→ 手指稍抖就取不到格信息 |
| 编辑 | `pan-y pinch-zoom`（`PixelEditorCanvas.tsx:670`） | 可捏合，但**横向平移被禁**；当前 `fitCellSize` 保证不横向溢出所以暂不显形，一旦加编辑器缩放就会立刻暴露 |
| 裁剪 | `touch-none`（`ImageCropper.tsx:465`） | 正确（防下拉刷新）✓ |

两个图纸画布的手势约定不同，是同一产品内的肌肉记忆冲突。

---

## 5. 无障碍与质量地板

### 做得对的（保持）

- `Modal.tsx` 是一个合格的对话框实现：portal + 背景 `inert` + `aria-hidden` + Tab 循环 + Esc + 自动聚焦首控件 + 关闭后恢复焦点（`:23-101`）✓ 优于多数手写弹窗。
- `globals.css:50-59` 统一 `:focus-visible` 主粉描边环，覆盖 `a/button/[role=button]/select/checkbox/radio/summary` ✓。
- 工作台页签是标准 ARIA tabs：`role=tablist/tab/tabpanel` + `aria-selected` + `tabIndex -1` + ←/→ 键盘切换且焦点跟随（`Workbench.tsx:222-229, 981-1021`）✓。
- 编辑器 `aria-describedby="editor-keyboard-status"` 指向一个实时更新的 `role="status"`，播报光标位置与色号（`PixelEditorCanvas.tsx:664-674`）✓ 这是对 canvas 编辑器很好的处理。
- `role="alert"` / `role="status"` 使用普遍且区分正确（错误用 alert，进度/成功用 status）✓。
- 表单 `aria-label` / `htmlFor` 覆盖完整；`PaletteEditor` 每行输入都有 `aria-label={code N}` + `aria-invalid` ✓。

### 缺口

| # | 问题 | 位置 |
|---|---|---|
| A1 | **对比度不达标**：`#16a34a` 在 `#fdf8f4` 上 **3.13:1**（需 4.5），`#d97706` 上 **3.02:1** | `SaveStatus.tsx:24`、`AccountMenu.tsx:228,230` |
| A2 | `text-red-600 #dc2626` 在奶油底 **4.58:1** —— 刚过线，无余量；一旦放到 `bg-primary-soft` 上会掉到 4.3 | `PaletteEditor.tsx:156` 等 12 处 |
| A3 | **canvas 无替代信息**：两个 `<canvas>` 只有 `aria-label`（「图纸编辑画布」/ 无 label 的预览画布）。预览画布（`PatternPreview.tsx:222-231`）连 `aria-label` 都没有，读屏用户完全不知道那里有东西 | `PatternPreview.tsx:222` |
| A4 | 预览画布**不可聚焦**（无 `tabIndex`），键盘用户无法平移/缩放图纸，也无法查询格信息（悬停信息只由 pointer 事件驱动） | `PatternPreview.tsx:222` |
| A5 | 无 `prefers-reduced-motion` 分支（当前无动效故无违规，但 §7 提案必须同时补） | `globals.css` |
| A6 | 无 skip-link，工作台头部 + 工具条约 20 个可聚焦元素，键盘用户每次到画布要 Tab 20 次 | `layout.tsx` |
| A7 | 变换按钮只有 Unicode 符号 + `title`，无 `aria-label`（`title` 会被多数读屏读出，但触屏无 tooltip） | `EditorToolbar.tsx:145-158` |
| A8 | `role="status"` 滥用于非动态内容：缩放百分比 `<span role="status" aria-label="缩放">`（`PatternPreview.tsx:203`）会在每次点 ± 时播报；当前颜色指示器同理（`EditorToolbar.tsx:79`） | 2 处 |
| A9 | 缩略图 `alt` 全同名「图纸缩略图」 | `DesignsView.tsx:298` |
| A10 | 圆体字体栈无 web font 兜底，Android/多数 Linux 落回 `system-ui`；`font-semibold` + 非圆体在小字号下反而更硬 | `globals.css:33-35` |
| A11 | 三个原生 `window.confirm` 不受 `Modal` 的焦点管理保护，且无法被样式化（B07） | 见 B07 |


---

## 6. 文案改写表（`src/messages/zh-CN.ts`）

写作原则依据：从用户视角命名而非系统视角；同一动作在按钮/提示/结果中同名；报错说清「发生了什么 + 怎么办」；空状态给出下一步；状态词短、解释句长的分开放。

### 6.1 最该改的 15 条

| # | 键 | 原文 | 建议 | 理由 |
|---|---|---|---|---|
| C01 | `workbench.localOnly` | 未登录：设计仅保存在本机浏览器，注册后可云端同步 | 徽标：**仅存本机**；下方说明条：**这台设备上的浏览器里保存着你的设计。注册后可同步到云端，换手机也能继续改。** | 24 字整句挤在头部 `text-xs` 徽标位（B10）。徽标要能一眼扫，解释要能读完。"未登录"是系统视角，用户关心的是"我的东西在哪" |
| C02 | `workbench.quotaError` | 本地存储空间不足，请导出项目文件备份后清理浏览器数据 | 徽标：**空间不足**；说明条：**浏览器存不下了。先「导出项目文件」把这张图纸存到电脑上，再清理浏览器数据。** | 同上；且"导出项目文件"要与按钮同名（现在按钮是「导出项目文件」✓，文案里叫"项目文件备份"❌） |
| C03 | `workbench.unavailable` | 本地存储不可用（可能处于隐私模式），设计将无法保存 | **无法保存到这台设备：浏览器可能开着无痕模式。你仍然可以调参和导出图纸，但关掉页面后就找不回来了。** | 只说"无法保存"会让用户以为整个工具坏了；实际导出仍可用，必须说清还能做什么。"隐私模式"→"无痕模式"（中文浏览器实际用词） |
| C04 | `workbench.generating` | 正在生成图纸…（可继续调整参数，以最后一次为准） | **正在生成图纸…** ＋ 副行：**可以继续拖滑块，会按最后一次的设置出图。** | 状态句里塞机制解释；括号在 `text-sm` 单行里造成阅读顿挫 |
| C05 | `workbench.generateFailed` | 图纸生成失败，请重试。 | **这次没生成成功。可能是图纸尺寸偏大，把「目标宽度」调小一点再试；或者点这里重试。** | 只说"请重试"不告诉用户重试什么会变。需要给出一个可操作的变量 + 一个重试按钮 |
| C06 | `workbench.confirmRegenerate` | 当前图纸包含手工修补。重新生成会替换它们，是否继续？ | 标题：**重新生成会丢掉你的修补**；正文：**你手动改过的格子会被新图纸覆盖，这一步可以撤销（Ctrl+Z）。** 按钮：**重新生成** / **保留修补** | 系统视角（"包含手工修补"）→ 用户视角（"你手动改过的格子"）；"是否继续"是二义按钮，要用动词按钮；补上"可撤销"降低恐惧 |
| C07 | `workbench.undoRegeneration` | 撤销重新生成，恢复手工修补 | **恢复我刚才的修补** | 按钮文案叙述了实现（"撤销重新生成"），用户只关心结果 |
| C08 | `workbench.editorHint` | 编辑后将自动保存到本机 | **改动会自动保存**（且只在第一次编辑后出现一次，见 B29） | "本机"与头部徽标重复；常驻噪音 |
| C09 | `params.targetColorCount` | 目标颜色数 | **颜色数量** ＋ 副标题：**要买几种颜色的豆子。卡通 8–20，照片 24–48。** | "目标"是算法参数名。副标题把 `help.faqs` 里已有的建议前移到决策现场（B11） |
| C10 | `params.dithering` | 抖动 | **渐变过渡（抖动）** ＋ 副标题：**用两种豆子交错模拟中间色，照片的天空、皮肤过渡更自然；卡通图建议关掉。** | "抖动"是术语且字面意思相反（听起来像画面抖）。保留括号术语便于对照其他工具 |
| C11 | `params.targetWidth` | 目标宽度（格） | **图纸宽度（多少颗豆）** ＋ 副标题：**小挂件 20–40，杯垫 40–60，摆件 60–100。** | "格"对新手不等于"豆子颗数"；帮助页已有尺寸建议，应前移 |
| C12 | `params.invalidWidth` / `invalidColors` | 宽度需为 20–200 的整数 / 颜色数需为 2–128 的整数 | **宽度请填 20 到 200 之间的整数**（并**实际渲染出来** —— 现在这两条从未显示，输入越界只是静默回退） | 死文案 + 静默回退（B11）。措辞也从"需为"改成对话式 |
| C13 | `editor.replaceNone` | 图中没有该色号，未做任何修改 | **这张图纸里没有「{code}」这个色号。** ＋ 把「原色号」文本框改成下拉，从图纸实际用到的色号里选 | 让用户手打色号再告诉他打错了，是把系统的活推给用户。带上他输入的值便于自查 |
| C14 | `designs.emptyHint` | 点击「新建设计」上传照片，生成你的第一张拼豆图纸。 | **上传一张照片，两三步就能拿到可打印的图纸。** ＋ 空状态内嵌「新建设计」按钮 | 空状态不该指路到别处的按钮（B28）；"点击「新建设计」"在按钮就在旁边时是废话 |
| C15 | `workbench.paletteLoadFailed` | 自定义色板加载失败（可稍后在色板管理里重试） | **没能加载你的自定义色板。**［重试］ ＋ **内置品牌色板照常可用。** 且**必须真的渲染出来**（现在被 `Workbench.tsx:196-220` 静默吞掉） | 死文案 + 静默失败（B08）。把"还能做什么"说出来 |

### 6.2 一致性问题（同一动作多个名字）

| 动作 | 现有多种叫法 | 建议统一 |
|---|---|---|
| 回首页 | `nav.home`「首页」/ `errorPages.backHome`「返回首页」/ `help/page.tsx:52` 硬编码「← 返回首页」/ `about/page.tsx:71` 同 / `AuthShell.tsx:26`「← 首页」 | 全部 **「返回首页」** |
| 取消 | `crop.cancel` / `designs.cancel` / `exportPdf.cancel` / `palettes.editor.cancel` 四个独立键，值都是「取消」；`PngExportButton.tsx:118` 借用 `zhCN.designs.cancel`、`PixelEditorCanvas.tsx:679` 也借用 `designs.cancel` | 提到 `common.cancel` |
| 保存 | `workbench.save`「保存」/ `designs.save`「保存」/ `palettes.editor.save`「保存」，且 `AccountMenu.tsx:121` 借 `designs.save` | 提到 `common.save` |
| 已保存 | `workbench.saved`「本地：已保存」/ `designs.localSaved`「本地：已保存」/ `workbench.localSaved`「已保存到本机「我的设计」，登录后自动同步云端」 | 徽标统一「已保存」，位置信息用图标或分组标题表达，不要写在每个状态词里 |
| 删除确认 | `designs.deleteHint`「删除后云端副本也会删除，且不可恢复。确定删除「{name}」吗？」/ `palettes.deleteConfirm`「删除后不可恢复，确定删除该色板吗？」/ `account.deleteAccountHint`「注销将删除…不可恢复。请输入密码确认：」 | 统一句式：**「{对象} 会被永久删除，无法恢复。」+ 动词按钮「删除{对象}」**；不用"确定…吗？"（会导致按钮只能叫"确定/取消"） |
| 未同步 | `designs.unsynced`「未同步」/ `workbench.cloudPending`「云端：待同步」 | 统一「待同步」 |
| 重试 | `palettes.retry` / `designs.retry` / `errorPages.retry` 三键同值「重试」；`upload.retry` 是「重新选择」（语义确实不同 ✓） | 前三者提到 `common.retry` |

### 6.3 其他值得改的（次优先）

| 键 | 原文 | 建议 |
|---|---|---|
| `app.tagline` | 上传照片，生成拼豆图纸 | **把照片变成能照着拼的豆图**（价值而非步骤，见 §7.5） |
| `errors.TOO_LARGE_FILE` | 文件超过 20 MB，请压缩后再上传。 | **这张图 {size}，超过 20 MB 上限。用手机相册的"编辑→导出较小尺寸"或截个图再试。** 带上实际大小 + 具体做法 |
| `errors.HEIC_UNSUPPORTED` | 当前浏览器无法处理 HEIC 图片，请转为 JPEG/PNG 后重试。 | **这个浏览器打不开 iPhone 的 HEIC 照片。用 Safari 打开本页最省事；或在相册里「拷贝并保留原始文件」导出成 JPEG。** |
| `errors.DECODE_FAILED` | 无法解析该图片，文件可能已损坏。 | **这个文件读不出来，可能已损坏。换一张图片试试。** 补动作 |
| `preview.panHint` | 鼠标拖动或触屏滑动平移；按 Ctrl/Command + 滚轮缩放 | 折进 `?` 提示；文案改 **拖动可平移，Ctrl/⌘ + 滚轮缩放** |
| `editor.cursorHint` | 方向键移动光标，回车落笔；光标格有蓝色描边并自动滚入视野 | **方向键移动，回车落笔。** 后半句是实现说明；且"蓝色"与建议改成的紫色描边不符（B20） |
| `editor.clearTitle` | 清除全部（把整张图纸的格子全部清空为留空，可撤销） | 按钮 `title` 不该承载整段说明 → **清空整张图纸** |
| `designs.guestBanner` | 未登录：仅显示本机设计。登录后可云端同步，换设备继续编辑。 | **这里只显示这台设备上的设计。登录后会同步到云端，换手机也能接着改。**［登录］［注册］（补上从未渲染的 `goRegister`） |
| `authPages.registeredSent` | 注册成功！验证邮件已发送，请查收邮件并点击链接完成验证。 | **注册好了。验证邮件已发到 {email}，点邮件里的链接就能开始用。没收到？［重新发送］** 补"没收到怎么办" |
| `account.deleteAccountHint` | 注销将删除你的账号、全部云端设计与自定义色板，且不可恢复。请输入密码确认： | **注销会永久删除你的账号、云端的 {n} 张设计和 {m} 套色板，无法恢复。建议先导出项目文件备份。** 带上真实数量比抽象描述更能阻止误操作 |
| `onboarding.dismiss` | 我知道了 | 关闭按钮改 `×` + `aria-label="关闭引导"`（B36） |
| `nav.more` | 菜单与账户 | **菜单**（5 字按钮在 350px 头部太占宽，B26/移动端） |
| `home.uploadHint` | 拖拽图片到此处，或点击选择文件（支持拍照） | 与 `upload.hint` 统一为 **拖张图片进来，或点击选择**；"支持拍照"待 B26 决策 |

### 6.4 死文案清单（写了但从未渲染 —— 每条对应一处缺失的 UI 反馈）

| 键 | 对应缺失 |
|---|---|
| `workbench.stepUpload` / `stepCrop` / `stepWorkspace` | 三步流程没有步骤指示器（B09） |
| `workbench.paletteLoadFailed` | 云端色板加载失败静默（B08） |
| `params.invalidWidth` / `invalidColors` | 越界输入静默回退（C12） |
| `designs.limitError` | 设计数达上限（100）时无提示 |
| `designs.goRegister` | 游客横幅缺注册入口 |
| `home.guideStep1/2/3` | 首页三步说明（被 `onboarding.step*Title` 取代，应删） |
| `upload.title` | 上传步骤无标题（裁剪步骤有 `crop.title`，不对称） |


---

## 7. 视觉记忆点提案

前提：全部在「奶油白 + 低饱和粉紫 + 圆润 + 柔和阴影」内做，不引入新色相族、不引入像素/豆粒/马赛克元素（D30 明确排除）。先补两个缺失的 token 组，后面的提案都引用它们。

**建议新增 token（`globals.css` `@theme`）**

```
/* 状态色：与主粉同为低饱和、暖调，奶油底均 ≥4.5:1 */
--color-success: #2f7a52;   /* 奶油底 4.83:1 */
--color-warning: #9a5b12;   /* 奶油底 4.92:1 */
--color-danger:  #b03a3a;   /* 奶油底 5.02:1，比 #dc2626 更柔、更靠暖 */
--color-success-soft: #eaf5ee;
--color-warning-soft: #fdf1e3;
--color-danger-soft:  #fbebeb;

/* 动效：全站只用这三条 */
--ease-soft: cubic-bezier(0.22, 0.61, 0.36, 1);   /* 减速，收尾轻 */
--dur-quick: 140ms;   /* 颜色/描边 */
--dur-calm:  260ms;   /* 位移/淡入 */
--dur-reveal: 420ms;  /* 一次性揭示 */
```

配套（必须同时加，B30）：

```
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

### 7.1 生成完成的编排式揭示（最高价值）

**位置**：`Workbench.tsx:931-954`（进度行）→ `:1024-1032`（预览面板）
**现状**：进度行消失、canvas 内容瞬间替换、零反馈。这是整个产品的"魔法时刻"，目前完全没有被表达。

方案（三段编排，总时长 ≈700ms）：

1. **0–260ms**：进度行不直接消失，而是原地把文字换成结果句并向上淡出 6px：「已生成 100×100 · 6300 粒 · 34 种颜色」。`opacity 1→0`、`translateY 0→-6px`，`--dur-calm` + `--ease-soft`。同一句话写进 `role="status"` 供读屏播报。
2. **80–500ms**：图纸 canvas 淡入并轻微放大收敛：`opacity 0→1`、`scale 0.985→1`，`--dur-reveal` + `--ease-soft`。**不要**逐格出现或从左到右扫入 —— 40000 格的逐格动画在手机上会掉帧，且"扫入"是模板化 AI 设计的典型手法。
3. **300–700ms**：统计卡（`Workbench.tsx:1068`）的粒数做一次数字滚动到位（6300），色号列表前 8 行以 24ms 间隔依次淡入（只前 8 行，其余直接显示）。`ArcSignature` 的主粉弧线在统计卡右上角一次性描出（`stroke-dashoffset` 100→0，`--dur-reveal`），描完保持。

**不要做**：撒花/礼花/confetti；渐变流光边框；粉色发光 glow；"✨ 生成成功！"这类带 emoji 的欢呼；弹 toast 挡住图纸；音效。这些都会把"温柔治愈"变成"营销页"。

### 7.2 色板的展示方式（第二高价值）

**位置**：`app/palettes/page.tsx:172-181`（内置卡）、`PaletteEditor.tsx:230-270`（编辑行）
**现状**：291 色只以「291 色」四个字呈现；编辑器每行只有 hex 文本框。一个以颜色为核心的产品，颜色是不可见的。

方案：

1. **品牌卡上的色带**：卡片顶部一条 12px 高、`rounded-t-2xl` 的色带，把该品牌 291 色按 Oklab 色相排序后压缩成 291 个 1px 竖条（宽度自适应，`image-rendering: pixelated` 保证不模糊）。卡片其余部分保持 `card-surface` 不变。用户扫一眼就知道"漫德偏冷、盼盼粉系多"。
2. **展开全色**：卡片可展开（`<details>`）为 `grid-cols-[repeat(auto-fill,minmax(28px,1fr))]` 的 291 个色格，每格 `rounded-md`（4px，不要 `rounded-full` 圆点 —— 圆点会读成"装饰"，方圆角才读成"可选的颜色"），hover 显示色号 tooltip。格与格间距 `gap-1`，底色 `bg-cream-deep` 让浅色豆也有边界。
3. **编辑器每行加色块**：`PaletteEditor.tsx` 每行最左加 24×24 `rounded-md` 色块，点击唤起原生 `<input type="color">`。hex 文本框保留（批量粘贴仍需要）。
4. **色带作为签名元素复用**：设计卡（`DesignsView.tsx:307`）底部加一条 4px 高的该设计实际用色色带（按用量排序，宽度按占比）。用户在列表里就能凭配色认出自己的作品 —— 这比缩略图更有辨识度，也是这个产品独有的东西。

**不要做**：色格用圆形 + 阴影做成"糖果"；色带做成渐变（必须是离散竖条，因为拼豆本身是离散的 —— 这是产品真实性所在）；hover 放大弹跳。

### 7.3 图纸预览的呈现方式

**位置**：`PatternPreview.tsx:220-231`
**现状**：`bg-cream-deep/60` 容器 + `p-2` + canvas，图纸像一张贴在纸上的表格。

方案：

1. 给 canvas 容器加"图纸放在桌面上"的一层感：容器保持 `bg-cream-deep/60`，canvas 本体加 `shadow-card` 与 1px `--color-lilac` 描边，`rounded-none`（图纸是方的，圆角会削掉边缘格子的对齐感）。这一处的"纸感"来自阴影层次而不是纹理贴图。
2. 板缝线颜色从 `rgba(0,0,0,0.55)`（`draw.ts:67`）改为 `rgb(75 67 86 / 0.6)`（墨紫），网格线 `rgba(0,0,0,0.18)` → `rgb(75 67 86 / 0.2)`。图纸从"黑白表格"变成"同一家族的紫灰"，同时不损失打印可读性。
3. 悬停格信息（B23）改成跟随指针的浅色气泡：`bg-white`、`border --color-lilac`、`shadow-card`、`rounded-lg`、`text-ink`，内含 24px 色块 + 色号 + 行列。淡入 `--dur-quick`。**不要**用深色 tooltip（现状 `bg-ink` 黑条），奶油底上深色块太重。

**不要做**：给图纸加纸张纹理/噪点贴图；加"手绘胶带"装饰；给预览区加渐变背景。图纸本身的颜色就是主角，任何背景装饰都在抢它。

### 7.4 上传落点（第一次接触）

**位置**：`page.tsx:22-27`（首页）、`UploadDropzone.tsx:126-141`
**现状**：首页落点是伪落区（拖拽无效，B），工作台落点是灰虚线框。

方案：

1. 首页落点改成真落区（把 `UploadDropzone` 直接放首页，选中文件后再跳 `/app`），或至少在 `dragover` 时也响应并跳转。这是修一个功能预期，不只是视觉。
2. 落区静态态：`border-2 border-dashed`，颜色 `--color-lilac`，底 `bg-white/60`，`rounded-3xl` 保持。
3. `dragover` 态：描边 `--color-primary`，底 `--color-primary-soft`，**同时**整个落区 `scale(1.01)` + 描边虚线 `stroke-dashoffset` 缓慢位移一圈（`--dur-calm`，`animation: dash 900ms linear infinite`）。虚线"绕行"是这个动作最自然的隐喻（"这里在等你"），比放大发光克制。
4. 落区内加一个 `ArcSignature`（现有组件，`w-16`，`opacity 0.6`），把品牌签名放到用户第一次动手的位置。

**不要做**：上传图标用 ☁️ 或 📁 emoji；落区加"点击或拖拽"双行说明（一行足够）；`dragover` 时整页变色。

### 7.5 首页 hero 主张

**位置**：`page.tsx:12-18`
**现状**：`ArcSignature` + 「豆谱」`text-5xl` + tagline + description。三段文字都在描述工具本身，且 tagline 与 description 内容重叠。

方案：

1. 字体角色分层（当前全站只有一个角色）：
   - 品牌名「豆谱」：`text-5xl sm:text-6xl`、`font-semibold`、`--color-ink`、`tracking-wide` —— 保持。
   - 主张：`text-2xl sm:text-3xl`、`font-medium`、`--color-primary-deep`（奶油底 5.37:1），**换成价值句**：「把照片变成能照着拼的豆图」。
   - 支撑句：`text-sm`、`--color-ink-muted`（即修好 B01 后的 `ink-soft`），保留"免费、开源、无广告、无 AI"这组差异点，但压成一行：**「免费 · 开源 · 无广告 · 不用 AI · 原图不上传」**。这五个词是这个产品在同类工具里真正稀有的东西，值得排成一行中点分隔的短句而不是埋在长段落里。
2. `ArcSignature` 从标题上方移到主张右侧作行末装饰（`w-20`，垂直居中），让弧线"托住"主张而不是漂在标题上。
3. 首屏加载时：品牌名 + 主张 + 落区以 60ms 间隔依次淡入上移 8px（`--dur-calm`）。仅首屏一次，不重复触发。

**不要做**：hero 加大面积粉紫渐变背景；加浮动的圆形色块/blob；加"立即免费使用 →"这类转化按钮话术（产品本身免费无账号门槛，落区就是 CTA）；加数据吹牛（"已生成 X 张图纸"）。

---

## 8. 建议的执行顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 1（半天，纯收敛） | B01 `ink-soft` 值、B02/B03 状态色 token、B15/B16/B21/B20/B22/B32 颜色收敛、B24/B25 文案归位、B27 alt、B18 触控选择器 | 全是单值改动，无交互风险，一次拿到最大视觉一致性收益 |
| 2（1 天，反馈缺口） | B05 生成完成反馈 + §7.1、B08 色板失败提示、B10 徽标/长句分离、C12 越界提示、B06 pinch-zoom | 补齐"用户不知道发生了什么"的所有空洞 |
| 3（1-2 天，一致性） | B04 状态色统一 + `<Notice>`、B07 confirm→Modal、B17 导出面板统一、B14 导航复用 | 需要引入共享组件，改动面广但机械 |
| 4（1-2 天，记忆点） | §7.2 色板可视化、§7.3 图纸呈现、§7.4 落点、§7.5 hero | 依赖批次 1 的 token 就绪 |
| 5 | 重跑 `node docs/screenshots/capture.mjs` 更新 README 截图 | 必须在批次 4 之后 |

---

## 9. 需要用户拍板的设计决策

见回复正文的清单（共 8 项）。
