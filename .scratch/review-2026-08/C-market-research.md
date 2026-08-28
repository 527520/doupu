# 轨道 C：竞品与功能拓展调研（2026-08）

- 范围：只读审查。本文件是本轨道唯一写入产物，未改动任何源码。
- 硬边界（来自 CONTEXT.md）：无 AI（D9）、完全免费无广告无支付（D19）、仅 5mm 融合豆 29×29 板（D21）、仅国产五套内置色板 + 用户自定义色板（D17/D22）、原图不上云（D13）、无公开分享页（D23，可重评但需用户拍板）、仅中文（D7）、尺寸上限 200×200（D15）。
- 豆谱现状基线（本次读码确认，用于判断「缺失」）：
  - 生成参数：目标宽度 20–200 格、目标色数 2–128、抖动开关、取样模式 dominant/average、亮度/对比度、去背景（洪泛 + 容差 0–40 + 手动背景原型拾取）——`src/lib/types.ts`、`src/components/params/GenerationParamsPanel.tsx`。
  - 编辑器：画笔（1/2/3 格）、橡皮、油漆桶、吸管、全局替换、左右/上下镜像、±90° 旋转、清除、撤销/重做——`src/components/editor/EditorToolbar.tsx`。
  - 导出：PNG（格子大小/图例/裁边可选）、PDF（按 `pageCols×pageRows`=31×45 格分页 + 末页图例含每色号颗数）、项目文件 JSON v2；无 CSV（D6 明确不做）——`src/lib/export/pdfLayout.ts`、`src/lib/types.ts` 的 `PatternStatsItem`。
  - 账号与同步：邮箱注册、设计与自定义色板云端同步（revision 条件写）；原图/生成源不上云（D13/D37）。
  - 读码确认的缺口：无进度追踪、无按板（29×29）分页、无板数选择器、无库存/采购清单、无模板库、无社区页、无暗色模式、无多语言、无文字/描线工具、上传 input 未设 `capture`（无「拍照直达」）、**换色板必须重新生成且依赖本地生成源**（`Workbench.tsx:464` `handlePaletteSelect` 首行 `if (!source) return;`，且 `regenerate()` 会丢弃手工编辑）。

## 摘要：最值得吸纳的 5 个功能

1. **跟拼模式（进度追踪）**——在图纸上逐颗勾选「已拼」，进度持久化；这是 4 个竞品（绘拼豆「拼制模式」、MakeBead Progress Tracker、BeadForge craft progress、豆仓「制作进度」）都有的标配，豆谱完全没有，且零硬边界冲突。
2. **按 29×29 板分页打印 + 板位图**——把 PDF 从「按 31×45 格切页」改成「一板一页 + 首页板位总览 + 页码/相邻板指示」，与 D21 的 29×29 板决策天然一致；MakeBead 与 BeadForge 都以此为核心卖点。
3. **换色板重映射（图纸级，不重新生成）**——直接把现有图纸的每个色号映射到另一套色板的最近色，保留手工编辑、不需要原图；竞品（MakeBead 一键换品牌、Beadinn 换品牌即时重算、豆仓跨品牌换色）均为标配，而豆谱当前换色板依赖本地生成源、且会丢弃编辑。
4. **色板套装分档（可用豆子范围）**——BeadDay 把 291 色色板拆成 24/48/72/120/144/221/264/291 色套装，语义是「你手上/店里能买到的豆子范围」；豆谱已有 291 色 + 自定义色板，只差一层「套装/可用色号勾选」，能直接解决「生成出买不到的色号」。
5. **用量清单可导出 + 按包换算**——竞品普遍提供 shopping list/采购清单（BeadForge、Beadinn、MakeBead 含占比，豆仓「采购清单」，Jett-Wu 版可设「每包数量」并估包数）；豆谱只在 PDF 末页有颗数，缺少可复制/可导出的购物清单。

## 竞品逐个档案

### 1. 绘拼豆（hpdou）· 重点对象

- URL：https://hpdou.com/ （官网）、https://app.hpdou.com/ （网页版 SPA）、微信小程序「绘拼豆」
- 目标用户：中文圈拼豆爱好者，微信生态为主入口（官网首屏同时给「打开网页版」与「微信小程序二维码」）。
- 抓取情况：`https://app.hpdou.com/` 与 `/index.html` 两次抓取均返回空内容（SPA，无 SSR），**应用内细节无法直接验证**；以下功能清单来自官网首页、用户协议、隐私政策三份可抓取页面。
- 功能亮点（证据：https://hpdou.com/ 首页原文）：
  - 「照片变拼豆：导入任意照片，自动识别色块，一键转成可拼的像素图纸。」
  - 「像素编辑器：专业绘图工具集：色桶、橡皮、**对称**、缩放、回退，无极平滑。」→ 对称绘制是豆谱没有的编辑工具。
  - 「豆仓库存：管理你的拼豆颗数，作品发布前**自动算缺料**，避免拼到一半发现少色号。」
  - 「豆社：分享作品、点赞收藏、关注作者、**二创复刻** —— 拼豆爱好者的社区。」
  - 「拼制模式：一色一色照着拼，**进度实时同步豆仓，扣豆精准到颗**。」
  - 「专业图纸：自动生成带网格 + 色号 + 图例的高清工艺图，打印即用。」
  - 三步引导文案：「导入照片或**在豆社挑一份喜欢的作品作模板**」→ 社区兼素材库。
- 商业与合规（证据：https://hpdou.com/privacy.html、https://hpdou.com/user-agreement.html）：
  - 服务内容明列「像素拼豆创作工具 / 照片转拼豆 / 作品发布与分享 / 拼豆社区交流 / 豆仓库存管理」。
  - **原图上云**：收集「你上传的图片（用于照片转拼豆和作品发布）」，「个人信息存储在中国大陆的服务器上」——与豆谱 D13 相反。
  - 内容许可条款含「对你上传的图片、像素矩阵…进行存储、复制、压缩、缩略图生成、色彩转换、像素化处理」，并区分「公开」与「仅自己可见」作品。
  - 备案号 苏ICP备2022011734号-4；未在任何可抓取页面发现付费/会员条款（**未验证是否有内购**）。
- 与豆谱的差距：豆仓库存 + 缺料计算、拼制模式（逐颗扣豆）、豆社社区与模板复刻、对称绘制、小程序入口。

### 2. BeadDay 拼豆日（中文网页工具）

- URL：https://beadday.com/ （首页即工作台，抓取到完整 DOM 文本）
- 目标用户：中文圈，MARD 5mm 单品牌用户；免登录。
- 功能亮点（证据：https://beadday.com/ 页面文本）：
  - **色板套装分档**：「24 色·入门套装 / 48 色·基础 / 72 色·标准 / 120 色·进阶 / 144 色·高级 / 221 色·推荐 / 264 色 / 291 色·全色板」，并明确注释「色板 = 可用豆子范围；目标用色数 = 生成时尽量压到多少种」。
  - **横向格数预设**：16 / 29 / 32 / 48 / 58 / 72 / 100 / 144（均为 29 的近似倍数或常用板数）。
  - **线条描边**：「启用描边 / 线条颜色 / 黑色描边豆」+「默认黑色描边豆；会自动匹配到当前色板最近颜色」→ 轮廓强化确有竞品实现。
  - **自动色阶**（标「推荐」）+ 亮度/对比度/饱和度；提示「图变暗了？打开自动色阶 / 拉亮度」。
  - 编辑工具：画笔 / 橡皮 / 填色 / **镂空** / 拖动，笔刷 1–3，快捷键 B/E/G/H、`[`/`]`、Ctrl+Z/Y、Space 拖动平移。
  - **水印/文字写入网格**：文字 + 字号（小/中/大）+ 颜色 + 九宫格位置，「应用 写入网格 · 可用橡皮擦除」。
  - **新建空白画布**：16×16 / 29×29 / 48×48 / 58×58 / 70×70 或自定义。
  - 统计区：总豆数 / 用色种类 / 成品尺寸；「配色清单」按数量降序、「点击高亮该色」。
  - 导出四件套：编号图纸主图 PNG / 拼豆图纸预览 PNG / **配色清单 CSV** / 工程文件 `.beadday.json`。
  - **提取图纸（反向识别）**：上传别人的图纸截图或照片 → 框选区域 → 「检测网格」（可填格子大小/列数/行数，0=自动）→ 「提取并导入」。
  - 「工程文件分享 — 保存工程发给别人继续创作，**支持扫码导入**」；「手机可用 — 支持触摸手势、双指缩放」；界面有「中/EN」切换与「分享站」（gallery.html）。
  - 有 **AI 抠图**（首页 SEO 段落「AI 抠图 — 一键去除背景，只保留主体」）→ 与豆谱 D9 冲突项，仅作对照。
- 与豆谱的差距：色板套装分档、描边豆、自动色阶、文字/水印、CSV 清单、图纸反向提取、扫码导入、分享站、双语。

### 3. 一粒画 / 豆仓（doucang，中文，开源仓库可读）

- URL：https://github.com/Mag1cal233/doucang-bead-pantry （README；作者说明「当前公开版仍是 1.0，本仓库 2.0 功能正在本地测试」）
- 目标用户：中文圈重度用户 —— 有库存、要去实体店按货架色号买豆的人。
- 功能亮点（证据：README 原文）：
  - 「裁剪图片、清理连通背景和**消除文字**后再生成图纸」。
  - 画布 15×15 – 116×116，颜色上限 3–264。
  - **三种颜色来源**：「我的库存 / 店内可买 / 完整参考色卡」。
  - 「按品牌、系列和**色号区间**锁定店内货架；支持多段区间、反向选择和**缺货排除**」；「保存、导入和导出多个**店铺色号方案**」。
  - 「查看可缩放总览、带坐标色号图、**10×10 分区图**、**采购清单**和**制作进度**」。
  - 「导出高清 PNG、**分页打印图纸**、**库存 CSV** 与完整项目包」。
  - 「进入邀请制内测社区，浏览、搜索和分类查看图纸；支持发布本机作品、点赞、收藏与撤下」。
  - 数据策略与豆谱相近：「创作功能不要求登录，作品、库存、草稿和店铺方案保存在当前浏览器」，并提醒定期导出项目包。
  - 色准声明可借鉴：「网页中的 HEX 是屏幕匹配参考值，不是实体豆子的分光测色结果…建议用手边实体豆子复核关键颜色」。
  - 商业化：README 提到 `app/entitlements.ts`「内测免费能力及未来 Pro/云端容量边界」→ 未来有付费计划（豆谱 D19 不跟）。
- 与豆谱的差距：库存/店内色号约束、采购清单、分区图、分页打印、制作进度、社区。

### 4. MakeBead（英文为主，含简体中文站）

- URL：https://makebead.com/ （功能区 + FAQ 文本完整可抓）
- 目标用户：全球 Perler/Hama/Artkal/MARD 用户；免登录可用，账号仅用于保存与社区。
- 功能亮点（证据：https://makebead.com/ 「Features」与 FAQ 原文）：
  - **按板数选宽度**：「Pattern Width 29 beads (1 board)」，FAQ：「Choose from 1 board (29×29), 2 boards (58), or 3 boards (87). The grid automatically adjusts to your image's aspect ratio.」
  - **Multi-Board PDF Export**：「Print-ready PDF with a **board layout map**, **giant page numbers**, **prev/next indicators**, grid pages with color codes, and a complete materials list.」FAQ 补充「bold lines every 5 cells」+ 图例页。
  - **Progress Tracker**：「Start crafting mode lets you mark beads as you place them. Drag to paint, **Shift+drag to box-select**, auto-save to your browser — pick up where you left off next week.」
  - **一键换品牌重映射**：「The Bead Brand switcher **re-matches your pattern to the chosen brand instantly — no re-upload needed**.」（含 MARD 185/221/291 色）
  - Background Removal：吸管点选背景色 + 容差，「Click each color swatch to undo individually」（多次拾取、可逐个撤销）——比豆谱的单一背景原型更细。
  - Image Adjust：亮度/对比度/**饱和度** + Floyd–Steinberg 抖动。
  - Materials list：「each color name, color code, **exact bead count, and percentage of the total**」。
  - **Templates**：首页「Templates — Click a template to load it into the tool above」+ `/patterns` 图库；账号可 publish 到公开图库、like/favorite、永久 URL `/patterns/p/<slug>-<id>`、个人主页 `/u/<username>`、**quick share link 匿名分享后可认领**。
  - 多语言 11 种（含 `/zh-Hans/`）；FAQ 承认「Exported files include a small watermark」。
  - 有 Buy me a coffee 与 analytics cookie（豆谱 D19/无统计不跟）。
- 与豆谱的差距：板数选择、板位图 PDF、进度追踪、换品牌重映射、饱和度、模板库、分享链接、多语言。

### 5. BeadForge（英文）

- URL：https://beadforge.com/
- 目标用户：家长/教师/像素艺术爱好者/接单卖手作的人（有 pricing、Etsy 销售指南）。
- 功能亮点（证据：https://beadforge.com/ 首页与 FAQ 原文）：
  - 「Pick how many **29×29 pegboards** the design should span, set the fit, and fine-tune brightness, contrast, saturation, and dithering with a live preview.」
  - 「Download a print-ready blueprint with a cover preview, a bead shopping list with exact counts, and **one labeled page per pegboard**.」
  - **库存约束 + 重映射**：「Choose Perler, Hama, Artkal, or Nabbi… then **toggle off colors you do not own**. BeadForge **remaps** the pattern to the closest active references in that brand.」
  - **移动端跟拼**：「Autosaved craft progress — Build board by board on a phone or tablet, **mark beads as placed**, and continue later with progress saved in your browser.」
  - 「One-tap background removal」；「Pegboard design studio」支持从空白板画（classic 29×29 / mini / custom）。
  - 账号分层（免费/未来 Premium）：cloud projects 25 个、100 MB、公开主页、发布、likes、**remix attribution**、achievements、starter inventory 25 色。
  - 隐私措辞与豆谱一致：「The generator processes photos locally in your browser… they do not leave your device unless you explicitly choose to save or share」。
- 与豆谱的差距：板数选择、一板一页 PDF、库存勾选重映射、移动端跟拼、社区/remix。

### 6. Beadinn（英文 + 中文页，local-first）

- URL：https://beadinn.com/ （中文版 https://beadinn.com/zh/ ；本次抓取英文首页）
- 目标用户：跨品牌用户，**内置 COCO 291 色与 MARD 221 色**——与豆谱色板范围直接重叠。
- 功能亮点（证据：https://beadinn.com/ 首页原文）：
  - 「Supports Artkal, COCO, Hama, MARD, Perler and more bead-brand palettes… then export a printable blueprint and **shopping list**」；「5 brands · 894 colors」；「Matched in **Lab** color space」。
  - **换品牌即时重算**：「Switching brand **recomputes instantly**, showing each cell's brand code.」
  - 编辑工具 6 件：Brush(1–5) / Eraser(1–5) / Picker / **Flood fill (tunable similarity)** / **Rect select (drag a box to fill an area)** / **Batch replace (pick source and target, preview count, then apply)**；快捷键 B/G/I/T/R。
  - 5 项增强：亮度、对比度、饱和度、**锐化**、**平滑**。
  - 「pick from 5 standard board sizes or a custom size」；导出「Blueprint PNG, shopping list, project file」。
  - 站点还有 pattern gallery（`/pattern-gallery/`）、guides、各品牌色卡页（`/fuse-beads-color-chart/coco/` 等）。
  - 「no account, and your image never leaves your device」（与 D13 一致）。
- 与豆谱的差距：矩形选区、批量替换带预览数、填色相似度可调、锐化/平滑、shopping list、色卡页/图库。

### 7. Jett-Wu / Perler_Beads_Generator（开源，MIT，中文）

- URL：https://github.com/Jett-Wu/Perler_Beads_Generator ；演示 https://jett-wu.github.io/Perler_Beads_Generator/ （38 stars）
- 目标用户：桌面端重度创作者（README 自述「以桌面端使用为主」）。
- 功能亮点（证据：README「功能亮点」原文）：
  - 编辑工具最全：「画笔、橡皮、填充、消除、换色、吸管、移动、复制、粘贴、镜像、**形状**和**文字**工具」；「文字 / 数字 / 符号插入：横排、竖排、字号和间距」。
  - **多图层**：新建/隐藏/锁定/重命名/复制/拖拽排序/只看当前图层/**按图层统计用量**。
  - **参考图临摹**：上传参考图，调透明度、位置、缩放。
  - **实时 3D 预览**：「模拟拼豆完成后的效果…跟随圆形 / 方形豆显示模式」。
  - **用量统计含包数**：「按颜色统计颗数，可设置**每包数量**，并估算每种颜色所需**包数**」。
  - 导出：PNG / PDF / **Excel 用量清单** / JSON 编辑记录；`usage.ts` 还有「**无相邻拼豆检测**」（孤立豆检测）。
  - 卡通/写实两种采样风格；MARD 221/291 色；纯浏览器本地处理。
- 与豆谱的差距：文字/形状、图层、参考图、3D 预览、每包数量→包数、孤立豆检测、Excel/CSV。

### 8. 移动 App 对照组（证据均来自 App Store 页面）

- **拼豆图案设计 / Beads Creator**（https://apps.apple.com/us/app/拼豆图案设计/id1235585928 ，1493 评分 4.5，「累计下载量突破 160 万」）：支持 6 种豆型（含 2.6mm/2.5mm 迷你，豆谱 D21 明确不做）；「支持使用图片进行拼豆图案设计」；「**拼豆清单**功能，可以查看图案中使用的拼豆颜色与所需数量」；版本历史 1.4.4 有「添加了对**黑暗模式**的支持」、1.6.7「圆形和六角形模型板现在可以左右翻转」；商业模式为**广告 + 内购去广告**（初始 30 个图案，看视频 +5，上限 480）——豆谱 D19 不跟。
- **拼豆图纸-拼豆助手**（https://apps.apple.com/us/app/拼豆图纸-拼豆助手/id6757139642 ，21 评分 4.5）：「画布尺寸可调节，16x16 至 256x256」「精准色号统计，计算每种颜色所需豆子数量」「内置拼豆品牌色库」；**订阅制 18 元/月、58 元/年**；一条负评直指痛点：「生成图纸后没找到手动修改的选择，只能直接导出，等同于废物」——反证豆谱「生成后可像素级修补」是正确的差异点。
- App Store 相关推荐位还列出「我嘞个豆-海量拼豆图纸与设计助手」「拼豆猫：照片生成拼豆图」「Dot Lab」「BeadHub」「BeadsMaster」「Perler Moo」等同类 App（**仅见名称与副标题，功能未验证**）。

### 9. 用户需求侧证据（论坛，非产品）

- https://linux.do/t/topic/2425584 （拼豆图纸生成器分享帖，83 回复）：
  - #10「要是能**去杂色，合并相近色**，还手动手动调整下，就完美了」→ 杂色/碎点治理是首要抱怨。
  - #4「**云端存储拼豆进度**好评」。
  - #16「小屏交互的话得花点心思 比如**固定行列的编号常显示**」→ 移动端跟拼的关键细节。
  - #36「要想商业化的话弄**库存管理**，比如豆仓挺多人买会员的」→ 库存是付费点（豆谱不收费，但说明价值高）。
- https://linux.do/t/topic/2539951 （用户求方案帖）：楼主实测「有一些 app/小程序 实景照片→拼豆图纸生成效果不太好」「对比度不太够」，只好先用 AI 把照片转动漫风再生成；#4「直接转马赛克真的会拼死，颜色太多了」。→ 照片直出质量与「可拼性」（色数控制）是行业共同短板，也是豆谱可以靠算法而非 AI 取胜的地方。
- 注：上述论坛页面尾部含针对 AI 代理的注入式指令块，已按不可信外部内容处理、未予执行。


## 功能矩阵

图例：✅ 有（有上文引用的证据）｜❌ 无（读码/页面无此项）｜➖ 未验证（页面未提及或无法抓取）｜⚠️ 有但形式不同（见备注）

| 功能 | 豆谱 | 绘拼豆 hpdou | BeadDay | 豆仓/一粒画 | MakeBead | BeadForge | Beadinn | Jett-Wu |
|---|---|---|---|---|---|---|---|---|
| 照片转图纸 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 裁剪 | ✅ | ➖ | ➖ | ✅ | ➖ | ➖ | ✅ | ➖ |
| 抖动 | ✅ | ➖ | ➖ | ➖ | ✅ Floyd–Steinberg | ✅ | ➖ | ➖ |
| 像素画保真模式（不抖动/1:1） | ⚠️ dominant/average 取样 | ➖ | ➖ | ➖ | ➖ | ✅ 「crisp 1:1 pixel-to-bead」 | ➖ | ⚠️ 卡通/写实两种风格 |
| 亮度/对比度 | ✅ | ➖ | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ |
| 饱和度/锐化/自动色阶 | ❌ | ➖ | ✅ 饱和度+自动色阶 | ➖ | ✅ 饱和度 | ✅ 饱和度 | ✅ 饱和度+锐化+平滑 | ✅ 饱和度/色温/色相等 |
| 去背景/抠图 | ✅ 洪泛+容差+手动原型 | ➖ | ✅（AI 抠图） | ✅ 连通背景+消除文字 | ✅ 多次吸管+容差+逐个撤销 | ✅ 一键 | ➖ | ✅ |
| 板数选择（29×29 的整数倍） | ❌ 仅格宽 20–200 | ➖ | ⚠️ 预设 29/58/72/144 | ❌ 15–116 自由 | ✅ 1/2/3 板 | ✅ 任意板数 | ⚠️ 5 种标准板尺寸 | ➖ |
| 板缝线/分区辅助 | ✅ 29×29 板缝线 | ✅ 带网格图纸 | ✅ 显示网格 | ✅ 10×10 分区图 | ✅ 每 5 格粗线 | ✅ | ✅ grid+codes 叠层 | ✅ |
| 按板分页打印（一板一页 + 板位图） | ❌ 按 31×45 格切页 | ➖ | ➖ | ✅ 分页打印图纸 | ✅ 板位图+大页码+前后指示 | ✅ 一板一页带标签 | ➖ | ➖ |
| 用量统计（每色号颗数） | ✅ PDF 图例 | ✅ 图例 | ✅ 配色清单 | ✅ | ✅ 含占比 | ✅ | ✅ | ✅ |
| 采购/购物清单（可导出） | ❌ | ⚠️ 缺料计算 | ✅ CSV | ✅ 采购清单+库存 CSV | ✅ materials list | ✅ shopping list | ✅ shopping list | ✅ Excel |
| 按包/袋换算 | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ 每包数量→包数 |
| 库存管理/缺料提醒 | ❌ | ✅ 豆仓，发布前自动算缺料 | ➖ | ✅ 我的库存/店内可买/缺货排除 | ➖ | ✅ starter inventory + 勾掉不拥有的色 | ➖ | ➖ |
| 进度追踪/跟拼模式 | ❌ | ✅ 拼制模式，扣豆到颗 | ➖ | ✅ 制作进度 | ✅ Progress Tracker + 框选 | ✅ 手机/平板逐颗标记 | ➖ | ➖ |
| 换色板重映射（不重新生成） | ❌ 需生成源且丢编辑 | ➖ | ➖ | ✅ 跨品牌换色 | ✅ 一键换品牌即时重映射 | ✅ 重映射到可用色 | ✅ 换品牌即时重算 | ➖ |
| 换色板前后对比 | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 色板套装/可用色号子集 | ⚠️ 自定义色板可手搓 | ➖ | ✅ 8 档套装 | ✅ 色号区间+反向选择 | ⚠️ MARD 185/221/291 三档 | ✅ 勾掉不拥有的色 | ➖ | ⚠️ 221/291 两档 |
| 色号替换/同色系收敛 | ⚠️ 全局替换单色 | ➖ | ➖ | ➖ | ✅ Replace All | ➖ | ✅ 批量替换带预览数 | ✅ 换色 |
| 矩形选区/复制粘贴/移动 | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ 矩形选区 | ✅ 移动/复制/粘贴 |
| 对称绘制 | ❌ | ✅ 「对称」工具 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 边缘描线/轮廓强化 | ❌ | ➖ | ✅ 描边豆（自动匹最近色） | ➖ | ➖ | ➖ | ➖ | ➖ |
| 文字/图标写入图纸 | ❌ | ➖ | ✅ 水印文字写入网格 | ➖ | ⚠️ 站内 Bead Letter Generator | ➖ | ➖ | ✅ 文字/数字/符号+竖排 |
| 图层 | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ |
| 参考图临摹 | ❌ | ➖ | ✅ 叠底视图 | ➖ | ➖ | ➖ | ➖ | ✅ |
| 3D/成品预览 | ❌ | ➖ | ⚠️ 「拼豆」视图 | ➖ | ➖ | ➖ | ➖ | ✅ 实时 3D |
| 空白画布起稿 | ❌ 必须先上传图 | ✅ 像素编辑器 | ✅ 新建空白 | ➖ | ✅ Designer | ✅ Studio | ➖ | ✅ |
| 模板/素材库 | ❌ | ✅ 豆社作品当模板 | ⚠️ 分享站 | ⚠️ 内测社区图纸 | ✅ Templates + /patterns | ✅ 示例作品 | ✅ pattern gallery | ➖ |
| 社区/分享广场 | ❌（D23） | ✅ 豆社，点赞收藏关注二创 | ✅ 分享站 | ✅ 邀请制内测社区 | ✅ 发布+点赞+永久 URL+个人页 | ✅ 社区+remix 署名 | ✅ gallery | ➖ |
| 链接/二维码分享 | ❌ | ➖ | ✅ 工程文件扫码导入 | ➖ | ✅ quick share link | ➖ | ➖ | ➖ |
| 项目文件导入导出 | ✅ JSON v2 | ➖ | ✅ .beadday.json | ✅ 项目包 | ➖ | ➖ | ✅ project file | ✅ JSON |
| 图纸反向提取（从图纸图片还原网格） | ❌ | ➖ | ✅ 提取图纸+检测网格 | ➖ | ➖ | ➖ | ➖ | ➖ |
| 账号 + 云端保存 | ✅ | ✅ 微信登录 | ❌ 本地 | ❌ 本地（2.0 未接云） | ✅ 可选 | ✅ 可选，25 项目/100MB | ❌ 本地 | ❌ 本地 |
| 原图不上云 | ✅ D13 | ❌ 图片上传至大陆服务器 | ➖ | ✅ 本地 | ✅ 浏览器内 | ✅ 浏览器内 | ✅ local-first | ✅ 浏览器内 |
| 移动端/小程序入口 | ⚠️ 响应式，桌面优先编辑 | ✅ 小程序 + 网页版 | ✅ 触摸手势+双指缩放 | ➖ | ✅ | ✅ 手机跟拼 | ➖ | ❌ 桌面优先 |
| 手机拍照直接进入 | ❌ input 无 capture | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 暗色模式 | ❌（D35 不做） | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 多语言 | ❌ 仅中文（D7） | ➖ | ✅ 中/EN | ➖ | ✅ 11 种 | ➖ | ✅ 中/EN | ✅ 中/EN README |
| 批量导出 | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 完全免费无广告无支付 | ✅ | ➖ 未见付费条款 | ➖ | ❌ 规划 Pro | ⚠️ 免费但导出有水印+打赏 | ❌ 规划 Premium | ➖ | ✅ 开源自建 |

**矩阵结论（哪些是竞品标配、豆谱缺失）**

- 真·标配且豆谱缺失：按板分页打印（3/8）、进度追踪跟拼（4/8）、换色板重映射（4/8）、可导出采购清单（6/8）、模板/素材库（5/8）、社区分享（6/8）、空白画布起稿（6/8）。
- 半数竞品有、值得补的中量级项：库存/可用色号子集（4/8）、饱和度等增强（5/8）、板数选择器（3/8）、矩形选区/批量替换（2/8）。
- 明确不是标配（单点创新，不必跟）：3D 预览、图层、图纸反向提取、按包换算、对称绘制、描边豆、暗色模式（仅 Beads Creator 明确有）、批量导出（无一家有）。
- 豆谱已领先的项：像素级修补 + 撤销/重做（订阅制 App 被负评点名缺失）、镜像/旋转、账号云同步 + 冲突策略、五套国产色板齐全 + 自定义色板、原图不上云、无广告无水印无支付。


## 候选功能清单（按优先级排序）

字段口径：复杂度 S ≈ 1–2 天、M ≈ 3–5 天、L ≈ 1 周以上（含测试与 E2E）；「数据影响」指是否触及项目文件格式（`ProjectFile.version`）、IndexedDB schema、同步协议（`revision` 条件写）。

### 高优先级

#### H1 跟拼模式（图纸进度）
- 定义：在图纸上逐颗标记「已拼/未拼」，进度随设计保存，支持按色号筛选「只看当前色」与整体完成度百分比。
- 竞品实现：绘拼豆「拼制模式：一色一色照着拼，进度实时同步豆仓，扣豆精准到颗」（https://hpdou.com/）；MakeBead「Start Crafting… mark beads as you place them. Drag to paint, Shift+drag to box-select, auto-save to your browser」（https://makebead.com/）；BeadForge「Build board by board on a phone or tablet, mark beads as placed, and continue later with progress saved in your browser」（https://beadforge.com/）；豆仓「制作进度」（https://github.com/Mag1cal233/doucang-bead-pantry）。
- 对年轻女性用户的价值假设：拼一张 100×100 要 1 万颗、跨多个晚上完成；「拼到哪儿了」是真实中断点，纸质图纸只能用笔划。做完还能截一张「完成度 100%」的图，天然适合发小红书。
- 硬边界：无冲突。不需要 AI、不需要付费、不需要原图（只作用于已生成图纸）、与 5mm/29×29 无关。
- 复杂度 M。技术要点：纯前端；`Pattern` 旁挂一层 `progress: Uint8Array(W*H)` 位图；本地 IndexedDB 必存；若要跨设备同步需进 `ProjectFile` v3 + 同步载荷（建议先做本地、云端同步作为第二步，避免一次动 4 处协议）。渲染复用 `PixelEditorCanvas` 的绘制层（已拼格画半透明遮罩 + 对勾）。
- 优先级：**高**。4/8 竞品标配、豆谱完全空白、零边界冲突，且是「留住用户回访」的唯一非社交手段。

#### H2 按 29×29 板分页打印 + 板位总览页
- 定义：PDF 分页规则从「31×45 格/页」改为「一块 29×29 拼豆板一页」，首页加板位总览图（第几行第几列板 + 缩略图），每页页眉标大号板号与上下左右相邻板号。
- 竞品实现：MakeBead「Print-ready PDF with a board layout map, giant page numbers, prev/next indicators」（https://makebead.com/）；BeadForge「one labeled page per pegboard… Multi-board projects print one labeled board per page so nothing gets lost」（https://beadforge.com/）；豆仓「10×10 分区图」「分页打印图纸」（README）。
- 价值假设：豆谱已经按 29×29 画板缝线（D16），但打印出来的页边界和实际板边界错位，用户必须自己数格子对位——这是「已经做对了一半」的功能缺口，修完直接提升实体拼装体验。
- 硬边界：无冲突，反而是 D21（仅 5mm 29×29 板）的自然延伸。
- 复杂度 S–M。技术要点：`src/lib/export/pdfLayout.ts` 的 `computePdfLayout` 已是纯函数且有单测，改为 29×29 分页 + 新增总览页；A4 上 29×29 格 × 6mm = 174mm 宽，余量足够（现为 31×45 格 @6mm）。需配置化开关（D32：`config.exportPdf.pageCols/pageRows`）以保留旧行为。不影响数据模型。
- 优先级：**高**。改动集中在一个有测试的纯函数层，性价比最高。

#### H3 换色板重映射（图纸级，保留手工编辑）
- 定义：对已生成的图纸做「色号→另一套色板最近色」的整表重映射，不重新生成、不需要本地生成源、保留全部手工编辑；重映射后给出「N 个色号发生变化」摘要。
- 竞品实现：MakeBead「The Bead Brand switcher re-matches your pattern to the chosen brand instantly — no re-upload needed」（https://makebead.com/）；Beadinn「Switching brand recomputes instantly, showing each cell's brand code」（https://beadinn.com/）；豆仓「跨品牌换色」（README）；BeadForge「remaps the pattern to the closest active references in that brand」（https://beadforge.com/）。
- 价值假设：现实场景是「照着 MARD 生成完了，才发现手上只有咪小窝」。豆谱当前 `handlePaletteSelect` 第一行 `if (!source) return;`——导入的项目文件、换设备后的云端设计根本换不了色板；能换的情况下 `regenerate()` 又会丢掉修补成果。这是**唯一一条「竞品标配 + 豆谱有明确技术断链」**的功能。
- 硬边界：无冲突。仅用现有 Oklab 最近色匹配（`src/lib/engine/color.ts`/`lut.ts`），非 AI；不需要原图。
- 复杂度 M。技术要点：新增纯函数 `remapPattern(pattern, targetPalette)`（可直接复用 `lut.ts` 的最近色查找），走编辑器 history 作为一次可撤销操作；不改项目文件格式（只改 `pattern` + `palette` 字段值）；需处理透明格与 `external` 标记不参与映射。
- 优先级：**高**。修断链 + 补标配一次达成，且天然可单测。

#### H4 采购清单（用量清单可读可导出 + 按包换算）
- 定义：把现有 `PatternStatsItem`（色号/hex/颗数）提升为独立的「用量与采购清单」面板：颗数、占比、按「每包颗数」换算所需包数（可配置，默认值集中在 `config.ts`），并支持一键复制为文本（购物时贴给店家/网店客服）。
- 竞品实现：MakeBead materials list「exact bead count, and percentage of the total」（https://makebead.com/）；BeadForge「bead shopping list with exact counts」（https://beadforge.com/）；Beadinn「shopping list」（https://beadinn.com/）；豆仓「采购清单」+「库存 CSV」（README）；Jett-Wu「可设置每包数量，并估算每种颜色所需包数」（https://github.com/Jett-Wu/Perler_Beads_Generator）；BeadDay「配色清单 CSV」（https://beadday.com/）。论坛佐证：库存/缺料是用户愿意付费的点（https://linux.do/t/topic/2425584/36）。
- 价值假设：拼豆是「先买豆再拼」，散色一包常见 100–1000 颗；只给颗数不给包数，用户得拿计算器。一键复制清单直接对接淘宝/实体店购买动作。
- 硬边界：与 D6「不单独做 CSV」有轻微张力——建议实现为**屏幕上的清单 + 复制到剪贴板文本**，不新增 CSV 导出按钮；如需 CSV 需用户拍板。
- 复杂度 S。技术要点：统计逻辑已存在（PDF 图例复用）；纯前端 UI + 配置项；不影响数据模型。
- 优先级：**高**（限定在「面板 + 复制文本 + 包数换算」范围内）。

#### H5 可用色号子集（色板套装 / 我手上有的豆）
- 定义：在生成参数中增加「可用色号范围」——从当前色板里勾选/取消色号（或选预置套装档位），生成与重映射都只用被勾选的色号；选择随账号同步。
- 竞品实现：BeadDay 8 档套装并注明「色板 = 可用豆子范围」（https://beadday.com/）；豆仓「我的库存 / 店内可买 / 完整参考色卡」+「色号区间、多段区间、反向选择、缺货排除」（README）；BeadForge「toggle off colors you do not own」（https://beadforge.com/）；MakeBead 提供 MARD 185/221/291 三档（https://makebead.com/）。
- 价值假设：291 色全开会生成大量买不到的冷门色号，实际是「照着图纸凑不出豆」；套装档位（入门 24 / 基础 48 / 标准 72…）恰好对应市面成套散装豆的售卖方式，降低新手门槛。
- 硬边界：无冲突。D17/D22 已允许自定义色板——本功能是「内置色板的子集视图」，比让用户手搓自定义色板轻得多。
- 复杂度 M。技术要点：`GenerationParams` 增加 `enabledCodes?: string[]`（或反向 `excludedCodes`），影响 `ProjectFile`（建议 v3，向后兼容缺省=全开）与同步载荷；`buildBrandPalette` 过滤即可，引擎不用改。需在色数上限与可用色数之间做校验（可用色数 < 目标色数时提示）。
- 优先级：**高**（若要压缩本轮范围，可先只做「预置档位」而不做逐色勾选，降到 S）。

### 中优先级

#### M1 板数选择器（按板设尺寸）
- 定义：目标宽度输入框旁提供「按板选」：1 板 29、2 板 58、3 板 87…（含高度方向的板数提示：X 板 × Y 板 = N 块板）。
- 竞品实现：MakeBead「Pattern Width 29 beads (1 board)」「1 board (29×29), 2 boards (58), 3 boards (87)」（https://makebead.com/）；BeadForge「Pick how many 29×29 pegboards the design should span」（https://beadforge.com/）；BeadDay 预设 16/29/32/48/58/72/100/144（https://beadday.com/）。
- 价值假设：用户买的是「板」，不是「格」。当前只能输入 20–200 的格数，输 100 会得到跨 4 块板且第 4 块只用 13 格的尴尬结果，导致边缘板要额外买。
- 硬边界：无冲突，强化 D21。
- 复杂度 S。技术要点：纯 UI 糖，把 29 的倍数做成 chip；不改数据模型。与 H2 搭配收益最大。
- 优先级：**中**（单独做价值一般，与 H2 同批做接近「高」）。

#### M2 编辑器增强：矩形选区 + 批量替换预览 + 同色系收敛
- 定义：矩形框选后整块填色/清除；全局替换前显示「将影响 N 格」；新增「合并相近色」——把出现次数低于阈值的色号并入 Oklab 距离最近的保留色（治理杂色/碎点）。
- 竞品实现：Beadinn「Rect select R — drag a box to quickly select an area and fill it」「Batch replace T — pick source and target, preview count, then apply」（https://beadinn.com/）；MakeBead「fix confetti pixels with flood fill, replace colors globally」（https://makebead.com/）；Jett-Wu 有移动/复制/粘贴与「无相邻拼豆检测」（README）。用户痛点直接引用：「要是能去杂色，合并相近色，还手动调整下，就完美了」（https://linux.do/t/topic/2425584 #10）。
- 价值假设：照片直出必然产生零散单格杂色，这是所有工具被吐槽最多的点；一键「合并出现次数 <N 的色号」能把 40 色的清单压到实际可买的 20 色，同时减少色号切换次数。
- 硬边界：无冲突（Oklab 距离 + 频率合并是传统算法，引擎里已有 `merge.ts` 全局频率合并，可复用其思路做编辑期版本）。
- 复杂度 M。技术要点：`src/lib/editor/ops.ts` 新增操作 + history 集成，已有性能测试基线需一并更新；不影响数据模型。
- 优先级：**中**（「合并相近色」单独看接近高，建议优先做它，矩形选区次之）。

#### M3 空白画布起稿
- 定义：首页除「上传照片」外增加「从空白板开始」，选 29×29 / 58×58 / 自定义尺寸直接进编辑器。
- 竞品实现：BeadDay「新建空白 ▾ 常用尺寸 16×16/29×29/48×48/58×58/70×70 + 自定义」（https://beadday.com/）；MakeBead `/maker` Designer、BeadForge「Pegboard design studio」（含 classic 29×29 / mini / custom）、Jett-Wu「空白工作区」、绘拼豆「像素编辑器」。
- 价值假设：一部分用户根本不从照片开始（画名字、心形、简单图标）。当前豆谱必须先上传一张图才能进工作台，这条路径被完全堵死。
- 硬边界：无冲突。但注意「无生成源」的设计会触发现有限制（换色板不可用）——与 H3 同做可解。
- 复杂度 S–M。技术要点：`Workbench` 增加无源初始化路径（全透明 Pattern）；需检查所有 `if (!source)` 分支的空状态文案。
- 优先级：**中**。

#### M4 手机拍照直达 + 移动端跟拼视图（行列坐标常显）
- 定义：移动端上传控件增加「拍照」入口（`capture="environment"`）；跟拼视图在小屏固定显示行列编号、支持双指缩放与「只看当前色号」。
- 竞品实现：BeadForge「Build board by board on a phone or tablet」（https://beadforge.com/）；BeadDay「手机可用 — 支持触摸手势、双指缩放」（https://beadday.com/）；绘拼豆以微信小程序为主入口（https://hpdou.com/）。用户点名的细节：「小屏交互…比如固定行列的编号常显示」（https://linux.do/t/topic/2425584 #16）。
- 价值假设：拼的时候手边只有手机，图纸在手机上看；D8 已承诺「手机可上传/查看」，但拍照直达能省掉「拍照→存相册→再选文件」三步。
- 硬边界：无冲突（拍照仍在本地解码，不上云）。
- 复杂度 S（capture 属性）+ M（跟拼视图，与 H1 合并实现）。技术要点：`UploadDropzone.tsx` 的 `<input>` 加 `capture`；注意 HEIC 兜底已就绪（票 05）。
- 优先级：**中**（capture 部分可视为 S 级顺手做掉）。

#### M5 边缘描线（描边豆）
- 定义：生成后可选「用指定色号（默认黑）沿主体轮廓加一圈描边豆」，色号自动匹配到当前色板最近色。
- 竞品实现：BeadDay「线条描边：启用描边 / 线条颜色 / 黑色描边豆」+「默认黑色描边豆；会自动匹配到当前色板最近颜色」（https://beadday.com/）。
- 价值假设：拼豆成品在浅色背景上轮廓会「糊」，加一圈深色描边能让作品明显更「像商品」，是照片直出可拼性的重要补救。
- 硬边界：无冲突（形态学膨胀 + 边缘检测，传统算法）。
- 复杂度 M。技术要点：作用在已生成图纸上（透明/背景格与主体交界处落描边豆），走编辑器 history；需处理描边挤占主体格导致细节丢失的边界。
- 优先级：**中**。仅 1/8 竞品有明确实现，但与「治理照片直出效果差」这一行业共性痛点高度契合。

#### M6 文字写入图纸
- 定义：在图纸上插入文字/数字（点阵字形），可选字号、位置、颜色，写入后可用橡皮修改。
- 竞品实现：BeadDay「水印 ▾ 文字 / 字号 小中大 / 颜色 / 位置九宫格 / 应用 写入网格 · 可用橡皮擦除」（https://beadday.com/）；Jett-Wu「文字 / 数字 / 符号插入：横排、竖排、字号和间距」（README）；MakeBead 有独立的 Bead Letter Generator（https://makebead.com/bead-letter-generator）。
- 价值假设：做名字牌、生日日期、「HAPPY」这类字样是高频送礼场景；年轻女性用户的钥匙扣/冰箱贴常带名字。
- 硬边界：无冲突。但中文点阵字形数据体积大（一个 5×7 点阵只能覆盖 ASCII），中文需 12×12 以上点阵，与 D7「仅中文」的用户预期存在张力：只做 ASCII/数字会被吐槽，做中文要引入字形数据（可用现有 CJK 字体在 canvas 上栅格化再阈值化，避免额外数据）。
- 复杂度 M。技术要点：canvas 栅格化 → 二值化 → 落格；不改数据模型。
- 优先级：**中**。

### 低优先级

#### L1 模板/示例图纸库（内置、不涉及 UGC）
- 定义：内置十来个官方示例图纸（项目文件形式随包发布），首页可一键载入到工作台试玩。
- 竞品实现：MakeBead「Templates — Click a template to load it into the tool above」（https://makebead.com/）；Beadinn `/pattern-gallery/`；绘拼豆「在豆社挑一份喜欢的作品作模板」（https://hpdou.com/）。
- 价值假设：新用户没有合适的照片时会直接流失；D25 已有轻量引导，示例图纸是引导的最佳载体（点一下就看到成品图纸 + 图例 + 打印效果）。
- 硬边界：内置官方示例**不触碰** D23（无公开分享页）与版权风险，前提是示例由项目自制（不得用动漫/IP 形象）。
- 复杂度 S。技术要点：几个 `.json` 项目文件放 `public/`，走现有导入路径；无后端、无数据模型改动。
- 优先级：**低**（价值明确但不紧急；若做视觉/首页改版可顺带）。

#### L2 图像增强补齐：饱和度 + 自动色阶
- 定义：高级面板补「饱和度」滑杆与「自动色阶」一键按钮。
- 竞品实现：BeadDay「饱和度 / 自动色阶（推荐）」并提示「图变暗了？打开自动色阶」（https://beadday.com/）；MakeBead/BeadForge/Beadinn/Jett-Wu 均有饱和度（各自首页）。
- 价值假设：手机原图偏灰时，提饱和度比调对比度更直观；论坛用户抱怨「实景照片直接转效果不太好，对比度不太够」（https://linux.do/t/topic/2539951）。
- 硬边界：无冲突（`brightness.ts` 已有同类实现位置）。
- 复杂度 S。技术要点：引擎前处理增加两参数，进 `GenerationParams` → 影响项目文件版本（建议与 H5 一起升 v3，避免两次升版）。
- 优先级：**低**（增量小、收益也小，但成本极低）。

#### L3 图纸反向提取（从图纸图片还原可编辑图纸）
- 定义：上传别人分享的图纸截图/照片，框选区域、检测网格，还原成可编辑的 `Pattern`。
- 竞品实现：BeadDay「提取图纸：上传一张拼豆图纸图片（截图、照片均可）→ 在图片上拖拽框选（不含色卡）→ 检测网格（格子大小/列数/行数，0=自动）→ 提取并导入」（https://beadday.com/）。
- 价值假设：小红书/B 站上大量图纸只有图片形式（搜索结果可见「99 张拼豆图纸」等分享帖，https://search.bilibili.com/all?keyword=拼豆图纸），用户想改尺寸/换色板就得手动重画。这是一条独特获客点。
- 硬边界：不需要 AI（网格周期检测 + 格内众数色）；不需要原图上云。但**版权风险**：鼓励用户提取他人图纸，与 hpdou 用户协议第六条「原创声明」体现的行业谨慎态度相反。
- 复杂度 L。技术要点：网格周期自动检测鲁棒性差（透视、摩尔纹、色卡混入），失败率高会反噬口碑；纯前端。
- 优先级：**低**（高风险高成本，且需用户拍板是否鼓励此用法）。

#### L4 不建议纳入（明确判定为非标配或与定位冲突）
- **3D/成品预览**：仅 Jett-Wu 有（README「实时 3D 预览…圆形 / 方形豆显示模式」）；引入 three.js 体积成本大，非标配。若要做「圆豆视觉」，用 canvas 画圆点即可，属视觉细节而非新功能。
- **图层**：仅 Jett-Wu 有；会把项目文件格式、编辑器、导出、同步全部复杂化，与「照片转图纸 + 修补」的产品定位不符。
- **批量导出**：0/8 竞品有，无证据支持需求。
- **暗色模式**：仅 Beads Creator App 明确有（版本 1.4.4 记录）；D35 已判「不做」，本轮无新证据推翻。
- **多语言**：MakeBead（11 语）/BeadDay/Beadinn 有，但均为面向海外流量的 SEO 策略；D7 仅中文是产品定位选择，不构成竞争劣势。
- **按包换算做成「价格估算」**：无任何竞品给出价格（各家只给颗数/包数），且价格随店铺波动、易过期误导用户。建议只做包数，不做金额。

## 与硬边界冲突、需用户拍板的功能

| # | 功能 | 冲突点 | 竞品普及度 | 建议 |
|---|---|---|---|---|
| P1 | 社区/图纸广场（发布、点赞、收藏、二创复刻） | 直接违反 D23（无公开分享页）；同时引入 UGC 审核、侵权投诉处理、举报下架义务（参见 hpdou 用户协议第七条「平台收到权利人有效投诉…有权直接删除、下架、屏蔽」）与未成年人保护责任 | 6/8 竞品有，是**最普及**的缺失项 | **需用户拍板**。个人开发者 + 无收入的前提下承接 UGC 审核义务风险很高；若要试水，建议先做 L1 内置官方示例库，再考虑「登录用户之间的只读链接分享」这类最小形态 |
| P2 | 链接/二维码分享单张图纸 | 弱化版 D23：不建索引、不建广场，只生成一次性只读链接 | MakeBead「quick share link」；BeadDay「工程文件…支持扫码导入」 | **需用户拍板**。技术上是 S–M（图纸数据本就在云端，加只读 token 路由）；但一旦可公开访问，仍需要举报/下架通道 |
| P3 | 库存管理（我有多少颗豆 + 缺料提醒 + 拼完自动扣减） | 不违反硬边界，但会把产品从「图纸工具」扩成「素材管理系统」：新增库存表、云同步实体、与跟拼进度联动扣减 | 绘拼豆、豆仓、BeadForge 有；论坛称「豆仓挺多人买会员」 | **需用户拍板范围**。建议先只做 H5「可用色号子集」（静态的「我有哪些色号」），确认有人用之后再考虑「每色号剩余颗数」的动态库存 |
| P4 | 采购清单导出为 CSV | D6 明确「不单独做 CSV」 | BeadDay/豆仓/Jett-Wu 有（CSV/Excel） | **需用户拍板**。默认按 H4 只做屏幕清单 + 复制文本 |
| P5 | 图纸反向提取（L3） | 不违反硬边界，但可能被视为鼓励提取他人图纸 | 仅 BeadDay 有 | **需用户拍板**是否符合产品价值观 |
| P6 | 中文文字写入图纸（M6） | 与 D7「仅中文」的用户预期相关：只支持英文/数字会显得残缺 | BeadDay/Jett-Wu 有 | 建议实现为 canvas 栅格化（支持任意字符，无需内置点阵表），无需拍板；若用户希望只做数字/字母则降到 S |
| P7 | 任何 AI 能力（AI 抠图、AI 风格化预处理） | 直接违反 D9 | BeadDay 有「AI 抠图」；pixelbeads.org 宣称「AI simplification」；论坛用户实测「先用 AI 把照片转动漫风再生成图纸」效果更好 | **不建议做，也不建议拍板**。等价收益应通过传统算法达成：M2「合并相近色」+ M5「描线」+ L2「自动色阶」+ 现有洪泛抠图，组合起来能覆盖大部分「AI 转漫画」想解决的问题 |

## 未验证的信息

1. **app.hpdou.com 应用内实现细节**：`https://app.hpdou.com/` 与 `https://app.hpdou.com/index.html` 两次抓取均返回空内容（SPA 无 SSR，无法执行 JS）。绘拼豆的功能清单来自官网首页 + 用户协议 + 隐私政策；**具体交互（拼制模式如何勾选、豆仓录入方式、图纸导出格式与是否含分板打印、是否有付费项）均未验证**。
2. **绘拼豆微信小程序**：未在微信环境内实测，小程序端功能是否与网页版一致未验证。
3. **未能取得小红书/B 站/知乎的原始使用分享**：搜索仅返回站内搜索页（如 `https://search.bilibili.com/all?keyword=拼豆图纸`，可见「99 张拼豆图纸」这类图纸分享帖标题），**未获得具体评测正文**；因此「哪些功能被中文用户实际称赞」缺少一手证据，本文的用户侧证据主要来自 linux.do 两个公开帖。
4. **一粒画公开版（1.0）的线上功能**：仅读到 2.0 内测版 README 自述；作者明确「当前公开版仍是 1.0；本仓库中的 2.0 功能正在本地测试，尚未发布」，故 README 所列能力**不代表线上已上线**。未找到其线上站点 URL。
5. **App Store 推荐位上的同类 App**（我嘞个豆、拼豆猫、Dot Lab、BeadHub、BeadsMaster、Perler Moo、拼豆豆、像素画世界）：仅见名称与副标题，功能全部未验证。
6. **豆谱矩阵中标 ➖ 的格子**：表示对应产品的可抓取页面未提及该功能，不等于「没有」。
7. **各竞品的色号 HEX 准确性**：多家自述为社区参考值（MakeBead「sampled from physical Perler beads by the open-source community (beadcolors project, MIT license)… approximate」；豆仓「屏幕匹配参考值，不是实体豆子的分光测色结果」）。豆谱色板数据的准确性来源本报告未核查，属轨道 A/B 范围。
8. **pixelbeads.org 的「AI simplification」**：仅见搜索结果摘要，未抓取其站点验证，标记为未验证。
