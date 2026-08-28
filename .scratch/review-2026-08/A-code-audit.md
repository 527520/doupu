# 轨道 A：代码缺陷审查（豆谱 DouPu）

审查日期：2026-08-26 · 审查方式：只读静态审查 + 实测 lint/typecheck/test/performance
基线 commit：`3b6f36e fix: restore mobile and keyboard workbench flows`
工作副本未提交改动：`next.config.ts`（+LAN 源）、`package-lock.json`（fsevents 去 dev 标记）、`tsconfig.json`（仅 CRLF）、未跟踪 `.idea/`

> 本报告未修改任何源码。唯一写入为本文件。

---

## 摘要（最重要的发现）

1. **`npm run test` 在 Windows 上必然失败**（10 例 red / 809），而 `CONTRIBUTING.md:33` 把它列为提交前必过门禁 —— 维护者被训练成忽略红灯。CI 只有 ubuntu。
2. **编辑器撤销栈按「条数」限流而非「快照量」**：200×200 图纸连按 100 次旋转，实测保留 400 万个快照对象、堆增长 **578 MB**（可致标签崩溃）。
3. **PNG 导出选「48 px/格」+ 大图纸必然失败**：9600×9600 = 92.2 M px 超过代码自己的 67.1 M px 上限，且只回一句无信息量的「导出失败，请重试。」——用户无从知道要调小格子。
4. **PDF 导出每次冷启动要下载 16.4 MB 全量中文字体**（`public/fonts/NotoSansCJKsc-Regular.otf`），子集化只发生在嵌入阶段，移动网络下体验极差。
5. **图纸高度静默钳到 200**，帮助文案却承诺「高度按图片比例自动计算」；手机竖屏截图（1080×2400）默认参数下被垂直压缩约 11%，无任何提示。
6. **`GET /api/designs` 与 `GET /api/palettes` 在读请求里执行 `DELETE`**（墓碑 GC），读接口带写副作用、无事务、无限流。
7. **配置项 `HEIC_WASM` / `PDF_FONT_SUBSET` 是死开关**：`config.ts` 读取、`.env.example` 与 `docker-compose.prod.yml` 都声明了，但应用代码从不消费 → 违背 D32「改配置即生效」。
8. **`src/lib/sync/engine.ts` 整个 LWW 模块是死代码**（105 行 + 29 个单测），实现的是被 D36/ADR-0009 取代的「按 updatedAt 覆盖」策略，虚增测试与覆盖率数字。

---

## 缺陷清单

| 编号 | 严重度 | 位置 | 现象 | 根因 | 修复方向 | 工作量 |
|---|---|---|---|---|---|---|
| A-01 | P1 | `tests/unit/releaseSafety.test.ts:40,98,157,221,258,285,327` | `npm run test` 退出码 1，10 例失败 | 测试直接 `spawnSync('mkdir',['-p'])`、`spawnSync('sh',…)`、`chmodSync 0o755`，Windows 无 POSIX shell | 用 `mkdirSync({recursive:true})`；对 sh 依赖的用例加 `describe.skipIf(process.platform==='win32')` 或改为 docker/WSL 专属项目；CI 加 windows-latest matrix | M |
| A-02 | P1 | `src/lib/editor/history.ts:4,21`；`src/components/editor/PixelEditorCanvas.tsx:470-476` | 大图纸重复整图操作后页面卡死/标签崩溃 | `HISTORY_LIMIT=100` 限的是条目数；一次 rotate/clear/大面积油漆桶就是 40 000 个快照对象 | 改按快照总量封顶（如 ≤400 000）；整图变换存「操作 + 参数」而非逐格快照 | M |
| A-03 | P1 | `src/lib/export/layout.ts:12`；`src/components/export/PngExportButton.tsx:21,67` | 200×200 图纸选 48 px 导出 → 「导出失败，请重试。」 | 9600²=92.2 M px > `MAX_EXPORT_CANVAS_PIXELS`(8192²=67.1 M)；`CANVAS_TOO_LARGE` 没有专属文案 | 按图纸尺寸动态禁用/标注超限的格子档位；为 `CANVAS_TOO_LARGE` 写明确文案并给出建议档位 | S |
| A-04 | P1 | `src/lib/export/pdfFont.ts:11`；`public/fonts/NotoSansCJKsc-Regular.otf`(16 437 364 B) | 首次导出 PDF 需下载 16.4 MB 字体，弱网下按钮长时间「生成中」且可能超时 | 运行时 `fetch` 全量 OTF，子集化在 pdf-lib 嵌入阶段才发生 | 构建期预生成常用汉字 + 色号字符子集（数百 KB）；保留全量作为兜底；加下载进度/超时提示 | M |
| A-05 | P2 | `src/lib/engine/generate.ts:42`；`src/messages/zh-CN.ts:390` | 竖长图（h/w > 200/W）图纸被垂直压缩，无提示 | `M = min(200, …)` 与 spec §F3 一致，但 UI 从不告知比例已失真，帮助文案反而承诺按比例 | 生成前检测钳位并提示「已达 200 行上限，建议把宽度调小到 N」；或在裁剪页限制可选区域比例 | S |
| A-06 | P2 | `src/app/api/designs/route.ts:23`；`src/app/api/palettes/route.ts:21` | GET 请求触发数据库删除 | 墓碑 GC 挂在列表读路径上 | 移到 `instrumentation.ts` 的每日清理（`cleanupSyncTombstones` 已存在，功能重复）；GET 保持只读 | S |
| A-07 | P2 | `src/lib/config.ts:71-73,89,142-143`；`.env.example:64-65`；`docker-compose.prod.yml:46-47` | 设 `HEIC_WASM=false` / `PDF_FONT_SUBSET=false` 无任何效果 | 配置被定义与注入但无消费点（全仓库 grep 只命中定义处） | 二选一：接线到 `decode.ts` HEIC 兜底与 `pdf.ts` `subset` 参数；或删除开关并同步删 `.env.example`/compose | S |
| A-08 | P2 | `src/lib/sync/engine.ts:1-105`（全文件） | 死代码 + 29 个测试测的是已废弃策略 | D36 改为 revision CAS 后旧 LWW 模块未清理；生产只用 `clientAdapter.ts` | 删除文件与 `engine.test.ts`/`monotonic.test.ts`；`sanitizeClientTimestamp` 若仍需保留则移入 `revision.ts` | S |
| A-09 | P2 | `src/lib/engine/lut.ts:62,108` | 每套色板占 32 MiB，缓存 2 套 = 64 MiB 常驻（Worker 内） | `new Uint16Array(1<<24)` 覆盖全部 24-bit key 的惰性缓存 | 换成分页/Map 缓存或 15-bit 精确表 + 局部精修；`LUT_CACHE_LIMIT` 降到 1 并在空闲时释放 | M |
| A-10 | P2 | `src/lib/engine/merge.ts:72,82` | 大图纸 + 高 distinct 时合并阶段反复分配 | θ∈[0,60] 穷举里每次都 `cells.map()` 重建 40 000 个对象 | 先只算 distinct（用 hex→代表 hex 映射统计），命中目标后才物化一次 cells | S |
| A-11 | P2 | `db/client.ts:18` | 单条慢查询/网络挂死即耗尽连接池 → 全站 500 | `new Pool({max:10})` 无 `statement_timeout`/`connectionTimeoutMillis`/`idleTimeoutMillis`/`ssl` | 补齐超时与 keepalive；生产按需开启 TLS | S |
| A-12 | P2 | `src/app/api/designs/[id]/route.ts:46`；`src/app/api/palettes/[id]/route.ts:44` | 已登录用户可无限速写入 ~5 MB body 的 PUT | 同步端点只有 Origin/Content-Type 守卫，无 `checkRateLimit` | 复用 `rateLimit.ts` 为 sync PUT/DELETE 加每用户每小时上限 | S |
| A-13 | P2 | `src/app/api/internal/backup-alert/route.ts:29-38` | 公网可达的未鉴权入口，令牌爆破与日志投毒均不限速 | 无限流；`console.error` 直接打印攻击者可控的 500 字符 `message` | 加 IP 限流；令牌校验失败计数；日志内容做单行化转义；或用 Caddy 限制该路径来源 | S |
| A-14 | P2 | `vitest.config.mts:76-83` | 「src/lib 行覆盖 92.9%」不含安全核心 | coverage `exclude` 排除了 `session.ts`/`transitions.ts`/`guard.ts`/`rateLimit.ts`/`cookies.ts`/`db.ts` | 让 integration 项目也产出覆盖率并合并，或明确在文档里标注该数字的口径 | M |
| A-15 | P2 | `src/components/workbench/Workbench.tsx:710` | 自动保存可能不触发 | effect 依赖里没有 `dirtyRef.current`（ref 非响应式），仅靠 `pattern/name/generationDraft` 身份变化兜底 | 把 dirty 提为 state 或额外 `editGen` state 作为依赖 | S |
| A-16 | P2 | `src/lib/image/decodeCore.ts:157` | 8000×8000 JPEG 裁剪时 Worker 内需要完整位图（约 256 MB） | JPEG 为保证 EXIF 方向正确，放弃解码器 source-crop，先解全图 | 用 `ImageDecoder`/两段式（先按 EXIF 旋转成 PNG/中间缓冲再 crop），或对超大 JPEG 降级到预览级裁剪并提示 | M |
| A-17 | P3 | `src/lib/engine/generate.worker.ts:8,22,47` | `cancelledTasks` 可能永久留存条目 | 只在有对应 generate 任务跑完时 `delete`；单纯 `cancel` 消息（无 SAB 分支）不会被清理 | 收到 cancel 时若无在跑任务直接忽略；或给 Set 加容量/TTL | S |
| A-18 | P3 | `src/lib/engine/lut.ts:102-103,138` | k-d 栈可能越界写 | `boundStack` 长度 = palette.length，DFS 最坏栈深可达 n+1；Float64Array 越界写被静默丢弃 → 剪枝失效（结果仍正确，只是变慢） | 栈容量按 `palette.length + 2` 或树深度上界分配 | S |
| A-19 | P3 | `src/lib/auth/guard.ts:18,43` | Origin 判定信任 `x-forwarded-host`；空 `Content-Type` 直接放行 | 为兼容反代与 bodyless DELETE | 生产改为只信 `APP_URL` + 显式白名单；bodyless 放行仅限 DELETE 方法 | S |
| A-20 | P3 | `src/lib/auth/rateLimit.ts:27` | 若反代未注入 `x-real-ip`，客户端可伪造 `x-forwarded-for` 绕过限流 | 头信任链依赖部署正确性（Caddyfile 已注入，代码注释亦说明） | 加启动期自检：生产若首个请求缺 `x-real-ip` 则告警 | S |
| A-21 | P3 | `src/lib/engine/session.ts:257` | 被取代的任务不会收到 `onSettled` | `LatestGenerationTask.start()` 先 `cancel()` 清空 `active`，finally 里的身份检查因此不成立 | 明确契约：cancel 也走 `onSettled`，或在文档里写清 | S |
| A-22 | P3 | `src/components/editor/PixelEditorCanvas.tsx:283` | `Ctrl+B/E/G/I` 等组合键会误切工具 | 快捷键 switch 未排除修饰键（只对 z/y 做了 mod 处理） | 在 switch 前 `if (mod) return;` | S |
| A-23 | P3 | `src/components/editor/PixelEditorCanvas.tsx:311` | 硬编码中文 `'留空'` | 绕过 `src/messages/zh-CN.ts` 集中管理约定（D7 / zh-CN.ts 文件头明令禁止） | 移入 `zhCN.editor` | S |
| A-24 | P3 | `src/app/api/auth/register/route.ts:57-59` | 注册返回「邮箱已被占用」= 账号枚举口子 | 与 login/resend 的防枚举策略不一致（产品可用性权衡） | 若要一致：改为恒 204 并靠邮件告知；否则在 SECURITY.md 明确写为「已接受风险」 | S |
| A-25 | P3 | `src/lib/image/decode.ts:27` | `canDecodeHeicNatively` 是死代码（注释自称 legacy），仅测试引用 | 迁移到 Worker 探测后未清理 | 删除函数与对应测试 | S |
| A-26 | P3 | `db/client.ts:62,73-75` | 清理任务用 `.returning()` 仅为计数，把全部被删行读回内存 | 图省事 | 改用 `rowCount`（node-postgres 支持）或 `count(*)` 预统计 | S |
| A-27 | P3 | `src/lib/config.ts:105-107` vs `src/lib/export/pdfLayout.ts:35-36` | A4 尺寸 210/297 在两处硬编码 | 常量未共享 | `normalizePdfMetrics` 复用 `A4_WIDTH_MM/A4_HEIGHT_MM` | S |
| A-28 | P3 | `next.config.ts:7`（未提交改动） | 生产构建里内嵌了开发者的内网 IP `192.168.1.175` | 局域网验收时临时加入未回退 | 改为 `process.env.DEV_LAN_ORIGIN` 注入，或提交前回退 | S |


---

## P1 详述

### A-01（P1）`npm run test` 在 Windows 上无法通过，而它是强制提交门禁

**证据 —— 实测输出（PowerShell，仓库根目录）**

```
> doupu@0.2.0 test
> vitest run --no-file-parallelism --maxWorkers=1 --project unit --project serial --project integration

 Test Files  1 failed | 94 passed (95)
      Tests  10 failed | 798 passed | 1 skipped (809)
   Start at  21:27:47
   Duration  73.63s
exit code = 1
```

失败原文（节选 3/10）：

```
FAIL unit tests/unit/releaseSafety.test.ts > backup and release safety gates >
  executes the complete verified backup happy path with isolated adapters
Error: ENOENT: no such file or directory, open
  'C:\Users\Admin\AppData\Local\Temp\doupu-backup-test-HQPzQW\bin\pg_dump'
 ❯ makeExecutable tests/unit/releaseSafety.test.ts:40:7

FAIL … > dump failure exits non-zero and delivers the backup alert
Error: ENOENT: no such file or directory, copyfile
  'D:\project\perlerBeads\deploy\scripts\backup.sh' -> '…\scripts\backup.sh'
 ❯ tests/unit/releaseSafety.test.ts:98:5

FAIL … > reports backup health only while the last verified success is fresh
AssertionError: expected null to be +0 // Object.is equality
 ❯ tests/unit/releaseSafety.test.ts:285:26
```

**根因**（`tests/unit/releaseSafety.test.ts`）

```ts
// :155 目录创建走 POSIX 外部命令；Windows 上 mkdir 不接受 -p，静默失败
spawnSync('mkdir', ['-p', scripts, bin]);
// :157 于是随后的 copyFileSync 目标目录不存在 → ENOENT
copyFileSync('deploy/scripts/deploy.sh', deployScript);
// :287 被测对象本身是 shell 脚本，Windows 无 sh → status 为 null 而非 0
const stale = spawnSync('sh', ['deploy/scripts/backup-healthcheck.sh'], …);
```

失败的 10 例分两类：7 例是 `mkdir -p` / `copyFileSync` 的目录 ENOENT，3 例是 `spawnSync('sh', …)` 返回 `status: null`（进程未启动）。

**触发条件**：在 Windows 上执行 `npm run test`（无 WSL/Git-Bash 在 PATH 的 `sh`）。

**后续影响**：`CONTRIBUTING.md:33` 写明「提交前自查：`npm run typecheck && npm run lint && npm run test -- --run` 全部通过」，而 `.github/workflows/ci.yml:15` 只有 `runs-on: ubuntu-latest`。本仓库明显在 Windows 上开发（`.idea/`、`D:\` 路径、`.npm-cache`），因此维护者每次提交前都会看到红灯并被迫忽略 —— 这会掩盖后续真正的回归。这不是「测试写错了」的小事，而是质量门禁的可信度问题。

**修复方向**：
- `spawnSync('mkdir',['-p',…])` → `mkdirSync(dir, { recursive: true })`（跨平台，且 `chmodSync` 在 Windows 上无害）。
- 依赖 `sh` 执行 `deploy/*.sh` 的用例改为 `describe.skipIf(process.platform === 'win32')`，或独立成 `deploy` 项目并从默认 `test` 脚本移出。
- `.github/workflows/ci.yml` 增加 `windows-latest` 跑 `unit` 项目，防止再次漂移。

---

### A-02（P1）编辑器撤销栈按条数限流，大图纸整图操作会耗尽内存

**证据 —— 代码**

`src/lib/editor/history.ts`
```ts
export const HISTORY_LIMIT = 100;          // :4  ← 限的是「条目数」
push(entry: HistoryEntry): void {
  if (entry.snapshots.length === 0) return;
  this.undoStack.push(entry);
  if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();  // :21
  this.redoStack.length = 0;
}
```

`src/components/editor/PixelEditorCanvas.tsx`（旋转/镜像）
```ts
const onTransform = (op: TransformOp): void => {
  const st = stateRef.current;
  const beforeCells = st.cells.map((c) => ({ ...c }));            // :468  40 000 个新对象
  const { cells, width, height } = applyTransform(st.cells, st.width, st.height, op); // 又 40 000 个
  …
  historyRef.current.push({
    label: 'transform',
    snapshots: beforeCells.map((cell, i) => ({ index: i, before: cell, after: st.cells[i] })), // :472  40 000 个快照
    dims: { before: beforeDims, after: { width, height } },
  });
```

同类「整图级」操作还有 `clearAll`（`src/lib/editor/ops.ts:212`，遍历全部非透明格）与大面积 `floodFill`（`ops.ts:150`，最坏 W×H 个快照）。

**证据 —— 实测内存**（Node 24，`--expose-gc`，忠实复刻 `onTransform` + `EditHistory.push` 的数据结构与 200×200 规模）

```
undoStack entries = 100
total snapshots  = 4000000
heap growth (MB) = 578.3
```

**复现条件**：生成 200×200 图纸（`targetWidth=200`，spec 允许的最大规格）→ 进入「修补」页签 → 连续点击「旋转 90°」（或「清空」/大面积油漆桶）约 100 次。撤销栈条目数始终 ≤100，因此现有限流完全不生效，累积快照达 400 万个。

**用户可见后果**：编辑页逐步卡顿，`refreshStats`（每次操作都全量 `computeStats`）叠加 GC 压力；移动端与内存较小的机器会直接触发标签页崩溃（Chrome「页面无响应/已崩溃」），丢失未保存的修补 —— 而自动保存是 1 s 防抖，崩溃时最近一次编辑很可能还没落盘。

**修复方向**：
1. 立即缓解：`EditHistory` 增加 `totalSnapshots` 计数，`push` 后循环 `shift()` 直到总量 ≤ 一个绝对上限（例如 40 万 ≈ 单张满图的 10 倍）。
2. 结构性修复：整图变换（`mirrorH/mirrorV/rotateCW/rotateCCW`）是可逆的纯函数，历史里存「操作类型」即可，撤销时应用逆操作，无需逐格快照；`clearAll` 同理可存「原始 cells 引用 + 全清标记」。
3. `applyTransform` 目前每次都 `{...cell}` 深拷贝每个格子；格子对象是不可变的（`ops.ts` 注释明确「格子对象只整槽替换、从不原地修改」），可以直接复用引用，省掉一半分配。

---

### A-03（P1）PNG 导出的「48 px/格」档位对大图纸必然失败，且错误提示无信息量

**证据 —— 代码**

`src/components/export/PngExportButton.tsx`
```ts
const CELL_CHOICES = [8, 16, 24, 32, 48] as const;   // :21  UI 下拉可选 48
…
if (!result.ok) {
  setError(result.code === 'EMPTY_PATTERN' ? zhCN.export.pngEmptyError : zhCN.export.pngFailed); // :67
  return;
}
```

`src/lib/export/layout.ts`
```ts
export const MAX_EXPORT_CANVAS_DIMENSION = 65_535;
export const MAX_EXPORT_CANVAS_PIXELS = 8192 * 8192;   // :12  = 67 108 864
…
export function pngCanvasWithinLimits(size: { width: number; height: number }): boolean {
  return … && size.width * size.height <= MAX_EXPORT_CANVAS_PIXELS;
}
```

`src/lib/export/png.ts:95-98`
```ts
if (!pngCanvasWithinLimits(canvasLayout)) {
  return Promise.resolve({ ok: false, code: 'CANVAS_TOO_LARGE' });
}
```

`src/messages/zh-CN.ts:88` → `pngFailed: '导出失败，请重试。'`

**算术**：200×200 图纸、内容占满（`cropToContent` 无法缩小）、`cellPx = 48` →
画布 9 600 × 9 600 = **92 160 000 px** > 67 108 864 px → `CANVAS_TOO_LARGE`。
`cellPx = 32` → 6 400² = 40 960 000 ≤ 67 108 864 → 通过。因此 **48 档对任何长边 ≥ 171 格的满内容图纸都必然失败**（8192/48 = 170.7）。

**复现条件**：宽度 200 生成图纸 → 点「导出 PNG」→ 格子大小选「48」→ 确认。

**用户可见后果**：弹出红字「导出失败，请重试。」重试永远同样失败，用户没有任何线索该调小格子大小。同时 spec §F7 第 96 行写的是「输出上限：200×200×48 + 图例 ≈ 11000 px」——**代码自己的守卫与 spec 声明的最大配置互相矛盾**。

**修复方向**：
- 在 `PngExportButton` 里按当前 `contentBounds` 预算每个档位的画布面积，超限档位直接 `disabled` 并加后缀说明（例如「48（本图纸过大）」）。
- 给 `CANVAS_TOO_LARGE` 单独文案：「图纸太大，画布超出浏览器上限，请把格子大小调到 32 或更小。」
- 顺带复核 `MAX_EXPORT_CANVAS_PIXELS = 8192²` 的注释「保守取 Chromium/Firefox/WebKit 可靠交集」：iOS Safari 的 canvas 面积上限历史上是 16 777 216 px（4096²），远低于 8192²。默认档 24 px 下 200×200 已是 4 800² = 23.04 M px，超过该值 —— 见「未验证的疑点」。

---

### A-04（P1）每次冷启动导出 PDF 都要下载 16.4 MB 全量中文字体

**证据 —— 代码与文件**

`src/lib/export/pdfFont.ts`
```ts
let cached: Promise<Uint8Array | null> | null = null;
export function loadPdfCjkFont(): Promise<Uint8Array | null> {
  if (!cached) {
    cached = (async () => {
      const response = await fetch('/fonts/NotoSansCJKsc-Regular.otf');   // :11
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    })();
  }
  return cached;
}
```

文件大小（实测目录列表）：`public/fonts/NotoSansCJKsc-Regular.otf` = **16 437 364 字节**。

`src/lib/export/pdf.ts:139-142`
```ts
if (options.fontBytes && options.fontBytes.length > 0) {
  doc.registerFontkit(fontkit);
  font = await doc.embedFont(options.fontBytes, { subset: true });   // 子集化只影响「嵌入产物」
  cjk = true;
}
```

`src/components/export/PdfExportButton.tsx:70-73`
```ts
const [{ generatePatternPdf }, fontBytes] = await Promise.all([
  import('@/lib/export/pdf'),
  loadPdfCjkFont(),              // 与 412 KB 的 pdf-lib 并行，但字体是它的 40 倍
]);
```

**触发条件**：任何用户首次点击「导出 PDF」（缓存失效后同样重现）。

**用户可见后果**：D35 把「PDF 字体子集」列为本轮交付项，实际只做到了「嵌入产物是子集」，**传输量没有优化**。按钮进入 `busy`（文案「生成中」）后，4G 下 16.4 MB 需要十几秒到数十秒，弱网/地铁场景会走到 `catch` → 「生成失败」。这与「无广告、轻量、移动端可导出」（D8/D19）的定位冲突，也让 `pdf-lib` 按需加载（优化票 08，412 KB）的收益被完全淹没。镜像体积也因此多出 16 MB。

**修复方向**：
1. 构建期生成子集：常用汉字（PDF 里实际出现的中文只有页眉「第 x/y 页 · 列 a–b · 行 c–d」、「图例」、「总计」、设计名）+ 数字 + 拉丁 + 色号字符。设计名是用户输入，需保留 CJK 常用字集（约 3 500 字，woff2/otf 子集通常 1–2 MB，subset 到常用 3500 字的 OTF 约 1.5 MB）。
2. 或改为服务端生成 PDF 时按需 subset 后再下发（但会违背「原图不上云」之外的架构简洁性，需权衡）。
3. 最低成本的缓解：给 `/fonts/*.otf` 加长期 `Cache-Control: public, max-age=31536000, immutable`（当前 `next.config.ts` 的 `headers()` 只给 `/_next/static/:path*` 加了 COEP/CORP，未给字体加缓存），并在按钮上显示「首次导出需下载中文字体（约 16 MB）」。


---

## 重点 P2 详述

### A-05 图纸高度静默钳位，帮助文案与实现矛盾

`src/lib/engine/generate.ts:42`
```ts
const M = Math.min(200, Math.max(1, Math.round((W * imageData.height) / imageData.width)));
```

`src/messages/zh-CN.ts:390`（帮助页）
> 目标宽度：图纸横向的格数（20–200），**高度按图片比例自动计算**。

钳位本身与 spec §F3 第 63 行「M = round(W × 源高/源宽)，clamp 到 [1, 200]」一致，**因此这不是实现违规，而是产品/提示缺口**：当 `W × h/w > 200` 时高度被截断，图纸相对原图被垂直压缩，界面上没有任何提示。

失真门槛：`h/w > 200/W`。默认 `W = 100` 时 `h/w > 2` 即开始失真。常见输入：
- 手机竖屏截图 1080×2400（h/w = 2.222）→ M 应为 222，实得 200，纵向压缩 **约 10%**；
- 长图/竖版海报 1000×3000（h/w = 3）→ M 应为 300，实得 200，压缩 **33%**。

`src/components/workbench/Workbench.test.tsx:106` 把同一条 `Math.min(200, …)` 公式复制进测试断言，因此测试只锁定了实现、无法发现「承诺 ≠ 行为」。

修复建议：`generatePattern` 返回 `heightClamped: boolean`（或由 Workbench 在调用前算一次），命中时在参数面板给出「已达 200 行上限，图纸比例与原图不同；把宽度调到 ≤ N 可保持比例」。另一条路是在裁剪页对超过 1:10 之类的极端比例给出提示（`ImageCropper` 已有原始比例锁，可引导用户主动裁成可表达的比例）。

---

### A-06 读接口带写副作用

`src/app/api/designs/route.ts:20-23`
```ts
const userId = await getVerifiedSessionUserId();
if (!userId) return apiError(new AppError('UNAUTHORIZED', '未登录'));
const db = getDb();
await db.delete(designs).where(and(eq(designs.userId, userId), lt(designs.deletedAt, tombstoneCutoff())));
```
`src/app/api/palettes/route.ts:21` 同构。

三个问题：
1. HTTP 语义：GET 应是安全方法。Next.js 的路由预取、浏览器重复请求、任何未来的 CDN/代理层都可能放大这次写。
2. 无事务、无 Origin 守卫（GET 本就不走 `enforceMutatingGuard`），删除动作因此完全不受 CSRF 层面的约束（虽然只删自己的过期墓碑，影响有限）。
3. **功能重复**：`db/client.ts:66-79` 的 `cleanupSyncTombstones` 已经由 `src/instrumentation.ts:16-25` 每 24 小时全库执行同样的清理。列表路径上的这次删除是多余的。

修复：删掉 GET 里的 `db.delete`，保留 `instrumentation.ts` 的每日清理即可。`[id]/route.ts` 的 PUT/DELETE 事务内那两处 `tx.delete(... tombstoneCutoff())` 属于写路径，可以保留（它们保证配额统计准确）。

---

### A-07 两个死配置开关

```
src/lib/config.ts:71-73   features: { heicWasm: boolean; pdfFontSubset: boolean }
src/lib/config.ts:89      features: { heicWasm: true, pdfFontSubset: true }
src/lib/config.ts:142     heicWasm: readBool('HEIC_WASM', DEFAULTS.features.heicWasm),
src/lib/config.ts:143     pdfFontSubset: readBool('PDF_FONT_SUBSET', DEFAULTS.features.pdfFontSubset),
.env.example:64           # HEIC_WASM=true               # 非 Safari 浏览器 HEIC 转换兜底
.env.example:65           # PDF_FONT_SUBSET=true         # PDF 使用子集字体（false 回退全量字体）
docker-compose.prod.yml:46-47   HEIC_WASM / PDF_FONT_SUBSET 注入容器
```

全仓库检索 `heicWasm|pdfFontSubset|HEIC_WASM|PDF_FONT_SUBSET` 的命中仅有上述定义/注入处，**没有任何消费点**：
- `src/lib/image/decode.ts:80-91`（HEIC WASM 兜底）无条件执行 `convertHeicWithWasm`，不看 `config.features.heicWasm`；
- `src/lib/export/pdf.ts:141` 无条件传 `{ subset: true }`，不看 `config.features.pdfFontSubset`。

后果：运维按 `.env.example` 设置 `HEIC_WASM=false` 期望关闭 `heic2any` WASM 兜底（该库体积与 CPU 成本都不小），实际毫无效果。这直接违反 D32「改配置即生效、无需改代码发版」，属于「配置说谎」——比没有开关更糟，因为它会误导运维排障方向。

修复：把两个 flag 接到实际分支，或删除 flag 并同步清理 `.env.example` 与 compose。

---

### A-08 已废弃的同步策略仍作为模块与测试存在

`src/lib/sync/engine.ts` 导出 `compareUpdatedAt` / `sanitizeClientTimestamp` / `reconcile` / `applyRemote` / `upsertLocal` / `markLocalDeleted`，文件头注释仍写「LWW 按 updatedAt」。

检索结果：这些符号的引用者**只有** `src/lib/sync/engine.test.ts`（25 处）与 `src/lib/sync/monotonic.test.ts`（8 处）。生产同步走的是 `src/lib/sync/clientAdapter.ts` 的 revision CAS。

这与 D36 明确写的「**不按客户端 `updatedAt` 静默覆盖**」正相反 —— 仓库里同时留着一个实现「按 updatedAt 静默覆盖」的模块，还有 29 个测试在保证它正确工作。风险有两层：

1. 数字失真：`809` 例测试与 `src/lib` 覆盖率里包含这 29 例对死代码的测试。
2. 真实回归风险：任何后续开发者（或 AI 代理）看到 `reconcile()` 这个名字很自然地会拿来用，从而在无声中把冲突策略退回 D36 明确否决的方案。

修复：删除 `engine.ts` + `engine.test.ts`；`sanitizeClientTimestamp` 若确有价值则连同 `monotonic.test.ts` 迁到 `src/lib/sync/revision.ts`。

---

### A-09 / A-10 引擎内存与合并阶段的重复分配

**A-09** `src/lib/engine/lut.ts:62`
```ts
// 65536 个下标页面的稀疏 Map 在抖动图片上会产生数百 MB 对象开销；
// 紧凑 Uint16Array 覆盖全部 24-bit key 仅 32 MiB，且无需填充 sentinel。
const indices = new Uint16Array(1 << 24);
```
`1 << 24 = 16 777 216` 项 × 2 字节 = **33 554 432 字节 = 32 MiB**，且是**急切分配**（不管实际查询多少种颜色）。配合 `lut.ts:108 LUT_CACHE_LIMIT = 2`，Worker 内稳定占用可达 **64 MiB**（外加 `coarseIndices` 64 KiB × 2）。注释里的权衡是成立的（比稀疏 Map 好），但在移动端 Safari 上，Worker 里 64 MiB + 主线程画布/图纸/缩略图会显著抬高 OOM 概率。此外 `lut.palette` 字段被缓存进 Lut 但**缓存键只用 hex**（`lut.ts:111` `palette.map(c => c.hex).join(',')`）—— 两套 hex 相同、色号不同的色板会共享同一个 Lut，其 `.palette` 字段因此可能是过期的。当前没有消费者读 `lut.palette`（`generate.ts:73-74` 用调用方的 `availablePalette`），所以尚未出问题，但这是一个已装填好的陷阱。

**A-10** `src/lib/engine/merge.ts:72,82`
```ts
const next = cells.map((cell) => { …新对象… });        // :72  每次阈值尝试都重建全部 cells
…
for (let theta = 0; theta <= 60; theta++) {            // :82  最多 61 次
  const candidate = applyThreshold(theta);
```
θ=0 时 `replaced.size === 0` 会走早返回（`merge.ts:70`），但只要开始合并，每个 θ 都会分配一个 40 000 元素的新数组 + 新对象。最坏 60 × 40 000 = 240 万次对象分配，仅为了得到 `distinct` 这个整数。

修复：把 `applyThreshold` 拆成两步 —— `countDistinct(theta)` 只算 `replaced`/`survivors`（O(n²)，n = distinct 颜色数 ≤ 500，代价极小），确定命中的 θ 之后再物化 cells 一次。

---

### A-11 / A-12 / A-13 服务端韧性缺口

**A-11** `db/client.ts:18`
```ts
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
```
缺 `statement_timeout` / `query_timeout` / `connectionTimeoutMillis` / `idleTimeoutMillis` / `keepAlive` / `ssl`。单机 10 连接的池子，一个卡住的语句就吃掉 10%；`/api/designs/[id]` 的 PUT 事务里还有 `select id from users … for update`（`[id]/route.ts:69`）与 argon2 之外的多次查询，长事务风险实际存在。生产环境一旦耗尽连接，`getDb()` 之后的所有请求都会 hang 到 Node 超时 → 全站不可用，而不是优雅 503。

**A-12** 同步端点无限流：`src/app/api/designs/[id]/route.ts:46` 的 `put` 只有 `enforceMutatingGuard` + `getVerifiedSessionUserId`，`readJson(request, LIMITS.projectFileBytes + 64 * 1024)` 允许约 5.06 MB body。存量上限（`designBytesPerUser = 50 MB`）限制的是**总存储**，不限制**写入速率**：一个已验证账号可以反复 PUT 同一个设计（每次 revision +1，通过 CAS），持续消耗 5 MB 解析 + JSON 序列化 + `for update` 行锁。`rateLimit.ts` 的基础设施已就绪，只是没接上。

**A-13** `src/app/api/internal/backup-alert/route.ts`
```ts
async function post(request: Request) {
  const body = await readJson(request, 4096);          // :29  无限流
  …
  const expected = process.env.BACKUP_ALERT_TOKEN ?? '';
  if (!expected || !safeEqual(parsed.data.token, expected)) {   // :36
    return apiError(new AppError('UNAUTHORIZED', '未授权'));
  }
  console.error('[backup-alert]', parsed.data.message);   // :41  攻击者可控内容进日志
```
`Caddyfile` 的 `reverse_proxy app:3000` 未排除 `/api/internal/*`，因此这是**公网可达的未鉴权入口**。`safeEqual` 做了常量时间比较（很好），但没有任何限流 —— 令牌爆破不受约束，只取决于运维选的令牌熵。`console.error` 直接打印最长 500 字符的 `message`，JSON 里的 `\n` 会解码成真换行 → 可伪造日志行（若日志被机器解析，可注入假的告警/成功记录）。

修复：给该路由加 IP 限流（复用 `checkRateLimit`）；`message` 打印前做 `.replace(/[\r\n]+/g, ' ')`；更彻底的做法是在 Caddy 里把 `/api/internal/*` 限制为容器网络来源。

---

### A-15 自动保存依赖了非响应式的 ref

`src/components/workbench/Workbench.tsx:708-712`
```ts
// 自动保存：dirty 时 1s 防抖（spec §F8）
useEffect(() => {
  if (step !== 'workspace' || !dirtyRef.current || !pattern) return;
  const timer = setTimeout(() => { void doSave(); }, 1000);
  return () => clearTimeout(timer);
}, [pattern, name, generationDraft, step, doSave]);
```
`dirtyRef.current` 参与了判断但不在依赖里（ref 变化不触发 render）。目前所有 `markDirty()` 调用点恰好都伴随 `pattern` / `name` / `generationDraft` 的身份变化，因此实际能跑；但这是隐式耦合 —— 未来任何一处「只置脏、不改这三者」的新代码路径都会静默丢失自动保存，而由于是「保存没发生」这种沉默失败，测试与人工走查都很难发现。建议把 dirty 提为 state（或用已有的 `editGenRef` 的 state 版本）作为显式依赖。

---

### A-16 超大 JPEG 的裁剪路径需要完整位图

`src/lib/image/decodeCore.ts:143-158`
```ts
let decoderAppliedCrop = false;
if (DIRECT_RESIZE_TYPES.has(type)) {          // 只有 png / webp / gif
  try {
    bitmap = await createImageBitmap(blob, x, y, w, h, { resizeWidth, resizeHeight, … });
    decoderAppliedCrop = true;
  } catch { /* 旧引擎不支持 */ }
}
if (!bitmap) bitmap = await openOrientedBitmap(blob);   // :157  JPEG 走这里 → 解全图
```
`DIRECT_RESIZE_TYPES = new Set(['png','webp','gif'])`（`decodeCore.ts:69`），JPEG 被有意排除（注释说明是为了避免「先按源坐标裁剪、后应用 EXIF 方向」导致的错位）。因此上传接近上限的 JPEG（`LIMITS.maxPixels = 8000×8000`，`validation.ts:38`）并裁剪时，Worker 内需要一个 64 M 像素的 `ImageBitmap`（RGBA 约 **256 MB**）。

好的一面：这发生在 Worker 里，失败会被 `catch` 转成 `DECODE_FAILED`，主线程不崩溃，且 `tests/fixtures/max-8000-square.png` 覆盖了 PNG 路径。风险面：没有对应的 8000×8000 **JPEG** 用例，移动端会得到「解码失败」而拿不到任何可操作提示（`zhCN.errors.DECODE_FAILED`）。

修复方向：JPEG 先只解出 EXIF 方向（已有 `dimensions.ts` 的头部解析基础设施），确认无旋转时也走 `DIRECT_RESIZE_TYPES` 的 source-crop 路径；有旋转时对超大图先降级到「按预览级精度裁剪」并提示精度损失，而不是直接失败。


---

## 架构层面的问题

整体印象：`src/lib` 的分层很干净（纯逻辑与 DOM/网络严格分离、几何/布局全部抽成可单测纯函数、错误码集中、文案集中），`any` / `@ts-expect-error` 零出现、`eslint-disable` 仅 5 处且都写了理由。问题集中在**组件层的单一巨核**与**模块生命周期缺少所有者**两点。

### 1. `Workbench.tsx`（1 041 行）承担了至少七种职责

它同时是：步骤状态机（upload/crop/workspace）、图片解码器所有者、生成会话宿主、本地持久化编排者、云同步冲突消费者、登录态探测器、导航守卫（`saveBeforeLeave`）与整页布局。可量化的症状：

- 25 个 `useState`/`useRef` + 13 个 `useEffect`；
- `consumeSyncOutcome`（`:566-651`，86 行单个 `useCallback`）内部同时做 IndexedDB 读写、`history.replaceState`、设计 id 切换、命名冲突计算与三种提示分支；
- `syncCloud` 依赖 `consumeSyncOutcome`，后者依赖 `source`（RGBA 缓冲）→ 每次上传都会让 `:702-706` 的 `online` 监听 effect 拆装一次并额外触发一次全量云同步；
- 「新上传 / 恢复设计 / 导入项目文件 / 重绑原图 / 冲突副本切换」五种进入 workspace 的路径各自手工重置 8–12 个状态位（`handleCropConfirm` / `loadCommittedProject` / `handleImport` / `resetWorkbench` / `consumeSyncOutcome`），任何一处漏一个字段就是一个静默数据错乱缺陷。仓库里已有此类修复痕迹（`:436` 注释「新设计不再对应 URL ?id= 的旧设计（否则刷新会恢复错对象）」、`PixelEditorCanvas.tsx:160` 注释「此前 stateRef 只在首帧初始化，外部新图纸会被旧 cells 静默覆盖（数据丢失缺陷）」）。

**拆分建议（按缝隙从大到小）**

| 抽出 | 承担 | 现有代码 | 收益 |
|---|---|---|---|
| `useDesignDocument()` hook | designId / name / createdAt / savedNames / dirty / saveState / `doSave` / `buildProject` | `:126-140, :514-560, :651-694` | 让「文档身份 + 落盘」可独立单测；消除 `dirtyRef` 与 effect 依赖的隐式耦合（A-15） |
| `useCloudSync()` hook | `syncCloud` / `consumeSyncOutcome` / cloudSaveState / online 重试 | `:566-712` | 冲突消费逻辑脱离 UI，可用假 storage/api 穷举 8 种冲突分支；切断 `source` → effect 拆装的伪依赖 |
| `useImageIntake()` hook | decoder 所有权 / `handleUpload` / `handleCropConfirm` / `handleCropCancel` / encodedSourceRef / rebind 标记 | `:326-441` | 把「legacy 注入解码器 vs 持久 Worker」两条兼容路径的分叉收在一处（当前该分叉在 3 个函数里各判断一次） |
| `<WorkbenchLayout>` 纯展示组件 | 全部 JSX（约 `:730-1041`） | — | 剩下的容器降到约 250 行 |
| `useAuthStatus()` hook | `/api/auth/me` 探测 | `:174-196` | 与 `AccountMenu`/`DesignsView` 共享（目前三处各自探测） |

`useGenerationSession` + `session.ts` 已经是这种做法的成功范例（reducer 纯函数 + `LatestGenerationTask` 独占任务令牌 + 同步 `stateRef` 镜像），把上面四块按同样模式抽出即可，无需引入状态库。

### 2. `PixelEditorCanvas.tsx`（632 行）：命令模型与 React 渲染的边界靠约定维持

`stateRef`（40 000 格）+ `historyRef` + `strokeRef` 都在 ref 里命令式修改，靠 `setVersion(v => v+1)` 触发重绘，并用整文件 `/* eslint-disable react-hooks/refs */`（`:3`）压掉告警。这个取舍在性能上是正确的（spec §F5 要求 200×200 单操作 < 50 ms），但代价是：

- 渲染期直接读 ref：`:133 const { width: W, height: H } = stateRef.current;` —— 旋转改变宽高后必须靠 `syncFlags` 的 `setVersion` 才能让 W/H 刷新，`syncFlags` 里已为此加了注释（`:150-153`）；
- `draw` 的依赖数组必须手工带上 `version` 并 `eslint-disable-line`（`:247`）；
- 「外部 pattern 变更 vs 自身回显」靠 `lastEmittedRef` 的引用相等判断（`:158`），一旦父组件对 pattern 做任何拷贝（例如序列化往返）就会误判为外部变更并清空历史。

**建议**：把命令模型整体下沉为一个与 React 无关的 `PatternEditorStore` 类（`getSnapshot()` / `subscribe()` / `apply(op)` / `undo()` / `redo()`），组件用 `useSyncExternalStore` 订阅。这样 ref 的 eslint 抑制、`version` 计数器、`lastEmittedRef` 引用比较三个 workaround 会同时消失，A-02 的快照配额也有了自然归属。

### 3. 模块级单例缺少生命周期所有者

`runGenerate.ts` 用 6 个模块级可变变量（`persistentWorker` / `persistentSource` / `sourceId` / `taskId` / `activeTask`）+ `lut.ts` 的 `lutCache`（32 MiB × 2）持有跨组件状态。`disposeGenerateWorker()` 只在 `Workbench.tsx:741,799,834`（卸载、导入、重置）被调用，而 `lutCache` **在生产环境没有任何清理入口**（`clearLutCache` 只被测试调用）。副作用：

- `handleImport` / `resetWorkbench` 里 `disposeGenerateWorker()` 会终止 Worker，下一次生成必须重建 Worker 并**从零重算 32 MiB LUT**（`buildLutUncached` 里 32 768 × 291 次 Oklab 距离），把「导入项目后改参数」这个常见动作变成一次冷启动；
- 若将来出现第二个 Workbench 实例（例如对比视图），两者会互相踢掉同一个 Worker。

**建议**：给引擎一个显式 `GenerationEngine` 实例（Worker + LUT 缓存都挂在实例上），由 Workbench 通过 `useState(() => createEngine())` 持有 —— 与 `createImageDecoder()`（`decode.ts:52`，已经是这个模式，含 `dispose()`）保持一致。`decode.ts` 的做法是仓库里更好的那个范例，`runGenerate.ts` 应该向它对齐。

### 4. 缺少缝隙导致的重复实现

| 重复 | 位置 |
|---|---|
| 文件名清洗两套规则（非法字符替换为 `-` vs `_`，一套截断 60 一套不截断） | `src/lib/export/layout.ts:52-66 sanitizeFilename` / `src/lib/export/pdfLayout.ts:180-190 sanitizeFilenamePart` |
| 图例列数两套算法 | `src/lib/export/layout.ts:78-90`（按列填充）/ `src/lib/export/pdfLayout.ts:158-172`（按行填充） |
| A4 尺寸常量 | `src/lib/config.ts:105-107` 硬编码 210/297 / `pdfLayout.ts:35-36` 有 `A4_WIDTH_MM/A4_HEIGHT_MM` |
| `ascii()` / `readU32BE()` 字节读取工具 | `src/lib/image/sniff.ts:9-20` 与 `src/lib/image/animation.ts:4-13` 逐字节复制 |
| 墓碑清理 | `api/designs/route.ts:23` + `[id]/route.ts:70,116` + `db/client.ts:66` 三处 |
| `/api/auth/me` 探测 | `Workbench.tsx:176` / `DesignsView.tsx` / `AccountMenu.tsx` |
| 统计重算 | `computeStats` 在 `generate.ts:105`、`editor/state.ts:28`、`Workbench.tsx:498,594` 各自调用并各自 `reduce` 求 total（4 处相同的 `stats.reduce((s,i)=>s+i.count,0)`） |

这些都属于"抽一个共享函数就能消掉"的量级，单个危害不大，但 `sanitizeFilename` 的两套规则意味着同一设计名导出的 PNG 与 PDF 文件名可能不一致（例如名字含 `:` 时 PNG 得 `-`、PDF 得 `_`），是用户可感知的。


---

## 工具链实测结果

全部在 `D:\project\perlerBeads`（Windows / PowerShell）实际执行。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run lint` | **0** | 零输出、零告警 |
| `npm run typecheck` | **0** | 零错误（`strict: true`） |
| `npm run test` | **1** | Test Files 1 failed / 94 passed (95)；Tests **10 failed** / 798 passed / 1 skipped (809)；Duration 73.63 s |
| `npx vitest run --project performance` | 0 | 4 files / 7 tests passed，Duration 1.72 s |

退出码取自 `cmd /c "npm run … > NUL 2>&1 & echo %errorlevel%"` 的独立确认：

```
LINT_EXIT=0
TYPECHECK_EXIT=0
```

### `npm run test` 明细

失败全部集中在单一文件 `tests/unit/releaseSafety.test.ts`（22 例中 10 failed / 12 passed），原因是 POSIX 依赖，见 A-01。其余 94 个测试文件全绿，含：

- `integration`：`designs.test.ts` 19 例、`auth.test.ts` 12 例、`transitions.test.ts` 10 例、`palettes.test.ts` 8 例、`db/models.test.ts` 11 例、`session-expiry.test.ts` 3 例（PGlite 真实 Postgres 语义）
- `unit`：`Workbench.test.tsx` 21 例、`PixelEditorCanvas.test.tsx` 26 例、`engine/modules.test.ts` 46 例、`crop/layout.test.ts` 33 例、`clientAdapter.test.ts` 24 例、`generate.test.ts` 17 例（含 50 组随机输入的属性测试，2 442 ms）
- `serial`：`PaletteEditor.test.tsx` 17 例、`password.test.ts` 4 例（argon2 原生模块隔离到 forks）

`performance` 项目**不在 `npm run test` 里**（`package.json:16` 只挂 `unit`/`serial`/`integration`），性能预算需单独跑 `npm run test:performance`；其中「200×200 图纸 + 291 色色板 < 2000 ms」与「取消标记写入后 100 ms 内停止 CPU」两条本次均通过。

### 未提交改动的隐患（`git diff`）

```diff
 next.config.ts
-  allowedDevOrigins: ["127.0.0.1"],
+  // 局域网验收：本机 LAN IP 也被视为同源，允许其请求 dev 资源（HMR/chunks）。
+  allowedDevOrigins: ["127.0.0.1", "192.168.1.175"],

 package-lock.json
@@ fsevents 2.3.2
-            "dev": true,
```

- `next.config.ts`：把开发者内网 IP 硬编码进受版本控制的配置（A-28）。`allowedDevOrigins` 只影响 `next dev`，生产无功能风险，但会泄露内网地址且对其他贡献者无意义。建议改成读环境变量。
- `package-lock.json`：`fsevents` 从 `dev: true` 变为运行时可选依赖。fsevents 是 macOS-only 的 `optional` 依赖，在 Linux 生产镜像里不会安装，**实际无影响**；但这行改动是 `npm i --omit=dev` 之类命令留下的副产品，说明 lock 文件被非 `npm ci` 的流程改写过。建议 `git checkout -- package-lock.json` 后重新 `npm ci` 以保证 lock 与 CI 一致。
- `tsconfig.json` 显示为 modified 但 `git diff --stat` 不列出 → 仅 CRLF 行尾差异（git 已提示 `CRLF will be replaced by LF`）。`.gitattributes` 存在但未覆盖 `*.json`，建议补 `* text=auto eol=lf`。

### 代码卫生统计（全 `src/`）

| 指标 | 数量 | 说明 |
|---|---|---|
| `: any` / `as any` | **0** | 检索无命中 |
| `@ts-expect-error` / `@ts-ignore` | **0** | 无命中 |
| `TODO` / `FIXME` / `XXX` / `HACK` | **0** | 无命中 |
| `eslint-disable*` | 5 | `PixelEditorCanvas.tsx:3,247`、`GenerationParamsPanel.tsx:60,76`、`DesignsView.tsx:301`，全部附理由 |
| 最大文件 | `Workbench.tsx` 1 041 行 | 其次 `PixelEditorCanvas.tsx` 632、`zh-CN.ts` 481、`ImageCropper.tsx` 464、`clientAdapter.ts` 412 |
| ObjectURL 泄漏 | 0 | 3 处 `createObjectURL` 均在同一函数内 `revokeObjectURL` |
| 事件监听泄漏 | 0 | 4 处 `addEventListener` 均有对应 cleanup（含 `ImageCropper` 的 `dragCleanupRef` 卸载兜底） |
| 死代码 | 2 处 | `src/lib/sync/engine.ts` 全文件（A-08）、`decode.ts:27 canDecodeHeicNatively`（A-25） |

依赖与供应链：`package.json` 全部使用 `^`/精确版本且有 `package-lock.json`（lockfileVersion 3），`next` 与 `eslint-config-next` 锁定为精确 `16.3.1`。未发现明显的不常用/可疑包（`heic2any`、`pdf-lib`、`@pdf-lib/fontkit`、`argon2`、`drizzle-orm`、`nodemailer`、`pg`、`zod` 均为主流库）。**本次未执行 `npm audit` / 未联网核对 CVE**，见「未验证的疑点」。CSP 实现（`src/lib/security/csp.ts`）用了 `nonce` + `strict-dynamic`，`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'` 齐备，`unsafe-inline` 仅保留在 `style-src-attr`（内联 `style` 属性渲染色块所必需），是合理收窄；`Caddyfile:14-20` 补齐了 nosniff / X-Frame-Options / Referrer-Policy / HSTS，并注释说明不覆盖上游 CSP。`src/proxy.ts:29` 的 matcher 排除了 `api`，因此 API 响应不带 CSP —— 对 JSON 端点影响可忽略（`nosniff` 由 Caddy 提供）。

---

## 未验证的疑点

以下条目**无法在本次只读、离线、无真机的条件下证实**，列出供后续验证，不作为缺陷结论。

1. **iOS Safari 画布面积上限**。`src/lib/export/layout.ts:12` 的 `MAX_EXPORT_CANVAS_PIXELS = 8192²` 注释自称是「Chromium/Firefox/WebKit 可靠交集」。据公开资料 iOS Safari 的 canvas 面积上限历史上为 16 777 216 px（4096²），若成立，则默认档 24 px 下的 200×200 图纸（4 800² = 23.04 M px）会在 iPhone 上得到空白或失败的 PNG，而代码守卫不会拦截。**需真机验证**（D8 要求手机可导出、D18 要求支持 Safari 最近两版）。
2. **WebP 的 EXIF Orientation**。`decodeCore.ts:69` 把 webp 放进 `DIRECT_RESIZE_TYPES`，用文件头尺寸（`dimensions.ts:120-146`）算 `resizeWidth/resizeHeight`。WebP 容器允许携带 EXIF 分块（含 Orientation）。若存在带旋转标记的 WebP，`imageOrientation:'from-image'` 会交换宽高，而 resize 参数仍按编码尺寸给出 → 预览可能变形。**未找到带 Orientation 的 WebP 样本，未验证**。
3. **`lut.ts` k-d 栈是否真会越界**（A-18）。`boundStack = new Float64Array(palette.length)`；理论最坏栈深为 n+1，但实际取决于剪枝效果。**未做插桩测量**。越界写在 TypedArray 上是静默丢弃，因此即使发生也只表现为变慢，不会出错。
4. **`generate.ts:42` 的 `imageData.width === 0`**。若宽为 0，`M` 会算成 `NaN`。上游 `validatePixelCount`（`validation.ts:44`）拒绝 `width <= 0`，`cropImageData` 在全部越界时返回 0×0。**未构造出能把 0 宽缓冲送进 `generatePattern` 的实际路径**，判定为不可达但未证明。
5. **PDF 大图纸的实际耗时与体积**。200×200 默认版式 = `ceil(200/31) × ceil(200/45)` = 7×5 = **35 页图纸页**，每页最多 31×45 = 1 395 个 `drawRectangle` + 同数量 `drawText`，合计约 4.9 万 + 4.9 万次 pdf-lib 调用。**未实测耗时/文件大小/移动端可行性**；`PdfExportButton.tsx:110` 仅在 >10 页时给出 `largeHint` 文案。
6. **`npm audit` / 依赖 CVE 状态**。未执行（避免联网与写 lock）。`next 16.3.1`、`argon2 ^0.45.1`、`heic2any ^0.0.4`（0.0.x 版本号、最后发布时间未核实）值得单独排查；`heic2any` 尤其需要确认维护状态，因为它是唯一进入前端包的 WASM 依赖。
7. **`enforceMutatingGuard` 的 `x-forwarded-host` 分支是否可被利用**（A-19）。分析结论是不可利用（浏览器不允许脚本设置 `Origin`，跨站请求的 `Origin` 恒为攻击者源），但**未做实际渗透验证**；若未来在应用前加入第二层代理/CDN 且未剥离该头，风险等级会上升。
8. **`hasWebpAnimation` / `countGifFrames` 对畸形文件的健壮性**（`animation.ts:37-125`）。循环均有 `off < bytes.length` 边界，`readU32BE` 越界返回 NaN 参与运算会使 `off` 变 NaN 从而退出循环 —— 看起来安全，但**未用模糊测试验证**是否存在能让循环长时间运行的构造（`tests/fixtures/` 已有 `corrupt.jpg` / `truncated.png` / `animated-2frames.*`，但无模糊测试）。
9. **A-02 的内存数字是复刻测量**。578 MB 来自忠实复刻 `onTransform` + `EditHistory.push` 数据结构的独立 Node 脚本（`--expose-gc`，200×200，100 次），**不是在真实浏览器中对本应用测得**。真实值会因 V8 版本、隐藏类与字符串共享而有出入，但量级（数百 MB）可靠。
10. **`heicWasm` / `pdfFontSubset` 是否曾有消费点**。本次结论基于当前 HEAD 的全仓库检索。**未回溯 git 历史**确认是「从未接线」还是「接线后被重构删掉」——这会影响修复取向（补接线 vs 删配置）。
