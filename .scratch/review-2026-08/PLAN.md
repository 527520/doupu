# 豆谱全面审查 · 实施计划（待用户确认）

审查日期 2026-08-26 · 分支 `main` · 三份证据报告：
- `A-code-audit.md`（代码缺陷，359 行，含 lint/typecheck/test 实测）
- `B-ui-audit.md`（UI/UX，505 行，36 条问题 + 文案改写表 + 视觉提案）
- `C-market-research.md`（竞品与功能拓展，358 行，8 个竞品 + 功能矩阵）

## 完成状态（2026-08-28）

批次 A–J 与新增批次 K（只读分享链接，决策 D38）已全部实现并通过本地门禁。
单测 918 通过 + 12 跳过、性能 7/7、覆盖率 src/lib 行 94.4%/分支 84.0%（门槛 90/75）、
typecheck/lint/build 全绿；分享链路已用真实浏览器端到端手验（见 `.scratch/verify-share.mjs`）。
新增决策 D38–D44 已记入 `CONTEXT.md`，分享决策另有 ADR-0010。

本文件只是计划。**未获用户确认前不改任何代码。**

## 0. 现状体检（实测）

| 项 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run test` | **退出码 1**：10 failed / 798 passed / 1 skipped（Windows 上必然失败，见 A-01） |
| 性能预算测试 | 7/7 通过 |
| 未提交改动 | `next.config.ts`、`tsconfig.json`、`package-lock.json`（进入审查前已存在） |

主代理已逐条复核的高影响结论（非转述）：
- `globals.css:19-20` `--color-ink-soft` 与 `--color-ink` 同为 `#4b4356` → 全站 47 处次要文字与标题同色。
- `editor/history.ts:4,21` 撤销栈按「条目」限流 100，条目内快照数无上限；200×200 图纸每次旋转产 40 000 快照。
- `export/pdfFont.ts:11` 每次冷启动导出 PDF 拉取 `public/fonts/NotoSansCJKsc-Regular.otf` = 16 437 364 字节全量字体。
- `PngExportButton.tsx:21` 提供 48px 档；`export/layout.ts:12` 上限 8192²=67.1M px，200×200×48 = 92.2M px 必被拒。
- `sync/engine.ts`（LWW）仅被自身测试引用 → 死代码，且实现的正是 D36 否决的策略。
- `config.ts:142-143` `HEIC_WASM` / `PDF_FONT_SUBSET` 无任何消费点 → 死开关，违反 D32。
- `tests/unit/releaseSafety.test.ts:20,43` 用 `spawnSync('sh'|'mkdir -p')`，Windows 无此命令。

## 1. 分批计划

批次内工作量：S ≤ 半天，M ≈ 1–2 天，L ≥ 3 天。全部走 TDD（先红后绿），每批收尾跑 lint + typecheck + test + 关键 E2E。

### 批次 A · 工程门禁与服务端安全（无产品影响，建议直接做）
| # | 内容 | 量 |
|---|---|---|
| A-01 | `releaseSafety.test.ts` 跨平台化（改用 Node API 或按平台 skip），恢复「提交前必过」的可信度 | S |
| A-11 | `db/client.ts` 连接池补 statement/connection/idle 超时 | S |
| A-12 | 同步 PUT（约 5MB body）接入限流 | S |
| A-13 | `/api/internal/backup-alert` 加限流 + 日志注入清洗（剥换行/控制字符） | S |
| A-06 | 把 `GET /api/designs`、`GET /api/palettes` 里的 `db.delete` 移出读路径（已有每日 `cleanupSyncTombstones`） | S |
| A-15 | 自动保存 effect 依赖非响应式 `dirtyRef` → 改为可响应状态 | S |
| A-14 | 覆盖率护栏纳入 `auth/session`、`transitions`、`guard`、`rateLimit`（当前被排除，92.9% 口径失真） | S |
| P3-1 | `next.config.ts` 移除内嵌内网 IP `192.168.1.175`，改环境变量 | S |

### 批次 B · 影响用户数据/成品的缺陷（含 4 项需拍板 → Q1–Q4）
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| A-02 | 撤销栈按「总快照数」限流，防 200×200 连续旋转吃掉 578MB 崩标签页 | M | Q1 |
| A-03 | 大图纸下 48px（及 32px）档不可用问题：动态禁用 + 说明，或补专属错误文案 | S | Q2 |
| A-04 | PDF 中文字体传输优化（构建期子集 / 按需分片），兑现 D35 | M | Q3 |
| A-07 | 死开关 `HEIC_WASM`、`PDF_FONT_SUBSET`：实现消费点或删除 | S | Q4 |
| A-08 | 删除 `sync/engine.ts` LWW 死代码 + 29 个单测 | S | Q4 |
| A-05 | 高度被静默钳到 200 时给出提示（帮助文案当前承诺「按比例自动计算」） | S | — |
| A-09 | LUT 64MiB 常驻，生产无释放入口 → 加释放时机 | S | — |
| A-10 | merge 阈值穷举最多重建 40 000 cells×60 次 → 改增量 | M | — |
| A-16 | 8000² JPEG 裁剪需 256MB 完整位图 → 分块或降采样 | M | — |

### 批次 C · 视觉与文案精细化（严格保留「温柔治愈」D30，含 Q5–Q7）
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| C-1 | `--color-ink-soft` 改为真正的次级色（建议 `#6b6276`，对比度 6.0:1） | S | Q5 |
| C-2 | 修 2 处对比度不达标：`text-green-600` 3.13:1、`text-amber-600` 3.02:1（均用于 `text-xs`） | S | — |
| C-3 | 新增 success/warning/danger(+soft) 六个 token，替换 18 个文件里 57 处硬编码状态色 | M | Q6 |
| C-4 | 抽 `<Notice kind>` 统一 20+ 处警示条（现有 4 条警示条用了 3 种琥珀配方） | M | Q6 |
| C-5 | 补字号/间距/圆角/动效/z-index token；圆角从 8 种收敛到 3–4 种，危险操作圆角统一 | M | — |
| C-6 | `.btn-primary`（手抄 8 次）/`.btn-outline`（12 次）/`.input-field`（8 次）收回组件类；删除 0 引用的 `.page-title` | M | — |
| C-7 | 3 处 `window.confirm` 换成品牌 Modal（现为双轨） | S | — |
| C-8 | 圆体中文字体加 web font 兜底（Android 当前看不到圆体） | S | Q7 |
| C-9 | 重跑 `docs/screenshots/capture.mjs`：README 两张图仍是升级前蓝色主题 | S | — |

### 批次 D · 关键旅程与移动端（含 Q8–Q10）
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| D-1 | 生成完成的反馈编排（当前进度行消失、图纸静默替换、无播报无焦点转移） | M | Q8 |
| D-2 | 三步指示器接线（`workbench.stepUpload/stepCrop/stepWorkspace` 文案已写好从未渲染） | S | Q9 |
| D-3 | 首页伪落区改真落区（现为长得像落区的 `<Link>`，拖图无反应）；`capture="environment"` 兑现「支持拍照」 | S | Q10 |
| D-4 | 接线其余 6 组死文案：云端色板加载失败（现被空 catch 吞）、`designs.limitError`、`params.invalid*`、`home.guideStep*` | S | — |
| D-5 | 预览画布放开双指缩放（现 `touch-action: pan-x pan-y` 禁掉），与编辑器手势对齐 | M | — |
| D-6 | 768–1023px（iPad 竖屏）断层：`lg:grid-cols-[1fr_320px]` 导致参数/导出被挤到图纸下方 | S | — |
| D-7 | 触控目标：44px 规则覆盖 `<a>` 与宽度（⇋⇵↺↻ 现为 44×28；首页导航 36px） | S | — |
| D-8 | 350px 拥挤项：保存状态徽标 24 字、预览工具条 9 控件折 4–5 行、编辑工具栏 14 控件折 6 行 | M | — |
| D-9 | 无障碍缺口：预览 canvas 无 `aria-label`/不可聚焦、无 canvas 替代信息、无 skip-link、无 `prefers-reduced-motion`、缩略图 alt 全同名、`role="status"` 滥用 | M | — |
| D-10 | 参数术语解释（颜色数量/抖动对新手不可懂）+ 越界输入提示 | S | — |

### 批次 E · 色板可视化（含 Q11）
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| E-1 | 色板页展示实际颜色（现 291 色只显示数字） | M | Q11 |
| E-2 | `PaletteEditor` 每行加色块 + 取色器（现仅 hex 文本框） | S | — |
| E-3 | 设计卡展示用色色带 | S | — |

### 批次 F · 功能一期：打印与采购（竞品标配，与已有板缝线自洽，含 Q12）
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| F-1 | 按 29×29 板分页打印 + 板位总览页（现 PDF 按 31×45 格切页，与板缝线错位） | M | — |
| F-2 | 板数选择器（1 板 29 / 2 板 58 / 3 板 87） | S | — |
| F-3 | 采购清单：每色号颗数 + 占比 + 按包换算 + 复制文本 | S | Q12 |

### 批次 G · 功能二期：跟拼模式（4/8 竞品标配，豆谱空白）
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| G-1 | 逐颗勾选已拼 + 进度持久化（先本地；云端需升项目文件与同步版本） | M | Q13 |
| G-2 | 移动端跟拼视图：行列坐标常显、当前行高亮 | M | — |

### 批次 H · 功能三期：色板与起稿自由度
| # | 内容 | 量 | 拍板 |
|---|---|---|---|
| H-1 | 换色板重映射（图纸级，保留手工修补）——当前 `Workbench.tsx:464` 要求本地生成源，导入/换设备的设计根本换不了色板 | M | — |
| H-2 | 空白画布起稿（现必须先上传图才能进工作台） | M | — |
| H-3 | 可用色号子集 / 色板套装档位（解决「生成出买不到的色号」） | M | Q14 |

### 批次 I · 可选增强
| # | 内容 | 量 |
|---|---|---|
| I-1 | 合并相近色（去杂色）+ 矩形选区 + 替换前预览数量 | M |
| I-2 | 边缘描线（描边豆，自动匹最近色；形态学膨胀，非 AI） | M |

### 批次 J · 架构重构（不改行为，为 F/G/H 降本，含 Q15）
| # | 内容 | 量 |
|---|---|---|
| J-1 | `Workbench.tsx` 1041 行 / 7 种职责 / 25 个 state·ref / 13 个 effect → 拆 `useDesignDocument`、`useCloudSync`、`useImageIntake`、`useAuthStatus`、`<WorkbenchLayout>`（照抄已成功的 `useGenerationSession`） | L |
| J-2 | `PixelEditorCanvas` 下沉为 `PatternEditorStore` + `useSyncExternalStore`（可同时消掉 3 个 workaround） | M |
| J-3 | 收敛 7 处重复实现（含两套文件名清洗规则 → 同一设计名的 PNG/PDF 文件名可能不一致） | S |

## 2. 建议顺序与理由

`A → B → C → D → E → J → F → G → H →（I 可选）`

- A 先做：测试门禁现在是红的，任何后续改动都没有可信的回归网。
- B 紧随：这几条会丢用户未保存的修补、让导出直接失败，属成品可见损伤。
- C/D/E 在功能前：视觉与旅程是本产品的核心竞争力（受众为年轻女性），且这些改动会波及所有新功能的界面，先统一 token 与组件再加功能，返工最少。
- J 放在功能前：F/G/H 都要往工作台加状态，1041 行的 Workbench 是三期功能共同的成本瓶颈。若时间紧，可只做 J-1。
- F 优先于 G/H：F 落在有单测的纯函数层（`pdfLayout.ts`），性价比最高，且修正了「已画板缝线却不按板分页」的自相矛盾。

## 3. 待用户拍板的问题（Q1–Q16）

见对话中的提问清单。未答复的问题对应条目一律不动工。

## 4. 明确不做（沿用既定决策）

- 任何 AI 功能（D9）：AI 优化、AI 生图、AI 抠图一概不做。
- 付费/广告（D19）、3D 预览、图层、批量导出（0/8 竞品有）、暗色模式、多语言（D7）。
- 原图或生成源上云（D13/D37）。
- 2.6mm 迷你豆与非 29×29 板（D21）。
