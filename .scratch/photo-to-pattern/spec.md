# 豆谱（DouPu）产品规格说明

- 版本：v1.0（2026-08-14，需求访谈 R1–R4 共识）
- 依据：`CONTEXT.md` 决策 D1–D29、`docs/adr/` 0001–0006
- 上游事实来源：`.scratch/photo-to-pattern/upstream/zippland`（AGPL-3.0）

## 1. 产品概述

豆谱是一个拼豆图纸生成网站：用户上传照片或像素画，裁剪并调整参数后生成拼豆图纸（W×H 色块网格），进行像素级修补，最后导出 PNG 图纸、打印版 PDF 或项目文件。支持账号体系与设计云端同步。完全免费、无广告、不含任何 AI 功能。

### 1.1 目标用户

拼豆爱好者（学生、家长、手工爱好者、专业玩家），以国内用户为主，仅中文界面。

### 1.2 非目标（明确排除）

- 任何基于神经网络模型的图像生成/优化（AI）
- 公开分享页、评论、社区功能
- 商业化：会员、广告、支付
- 海外品牌色板（Perler/Hama/Artkal）、2.6mm 迷你豆
- 独立 CSV 色号清单导出（清单并入 PDF 与项目文件）
- 多语言界面（文案集中管理，预留扩展）
- 微信公众号/小程序
- 原图上传云端

## 2. 用户旅程

**游客**：打开首页 → 上传图片（拖拽或点击选择/拍照）→ 裁剪 → 调参 → 生成图纸 → 编辑修补 → 导出 PNG/PDF/项目文件。设计仅存本地（浏览器 IndexedDB），提示注册可开启云端同步。

**注册用户**：注册（邮箱+密码）→ 邮件验证 → 登录后：设计自动云端同步、跨设备继续编辑、自定义色板随账号同步、找回/修改密码、注销账号。

## 3. 功能规格

### F1 上传与解码

- 接受格式：JPEG、PNG、WebP；HEIC 在支持原生解码的浏览器（Safari）直接解码，其余浏览器用 WASM 转码兜底（heic2any），转码中显示进度。
- 拒绝：动画 GIF/APNG/WebP（检测多帧后明确报错提示）、SVG、其他非图片文件、0 字节文件、损坏/截断文件（解码失败给出具体错误文案）。
- 大小上限：文件 ≤ 20 MB；解码后像素总数 ≤ 64 M（8000×8000），超出提示并引导裁剪。
- EXIF 方向：解码时按 `imageOrientation: 'from-image'` 自动转正；无方向信息的按原始方向。
- 16 位 PNG、CMYK JPEG、带 ICC 的图：以浏览器 sRGB 解码结果为准。
- 解码全程在本地完成，原图永不上传。

### F2 裁剪

- 上传后进入裁剪界面：自由比例框选（可拖动、缩放、移动），支持锁定 1:1 与原始比例；默认选中完整图片。
- 裁剪结果生成新的源图（本地 Canvas），进入参数面板。
- 透明底 PNG 裁剪时保持 alpha 通道。

### F3 生成参数

| 层级 | 参数 | 范围 | 默认 |
|---|---|---|---|
| 核心 | 目标宽度 W（格数） | 20–200，整数 | 100 |
| 核心 | 目标颜色数 K | 2–128，整数 | 40 |
| 核心 | 抖动开关 | 开/关 | 关 |
| 高级 | 取样模式 | 主色（dominant）/ 平均色（average） | 主色 |
| 高级 | 亮度 | -100–100 | 0 |
| 高级 | 对比度 | -100–100 | 0 |
| 高级 | 背景去除开关 | 开/关 | 关 |
| 高级 | 背景容差 τ | 0–40 | 8 |
| 高级 | 色板品牌 | MARD / COCO / 漫漫 / 盼盼 / 咪小窝 / 自定义 | MARD |

- 目标高度 M = round(W × 源高/源宽)，clamp 到 [1, 200]；W×M ≤ 40000。
- 参数变化后重新生成（防抖 300 ms）；生成期间显示进度，生成结果可取消。
- 生成耗时预算：200×200 ≤ 2 s（中端笔记本）；20×20 ≤ 100 ms。

### F4 生成管线（确定性顺序）

1. **预处理**：亮度/对比度线性变换（out = clamp((in-128)×(1+c/100)+128+b×1.28, 0, 255)）。
2. **抖动（可选）**：Floyd–Steinberg 误差扩散（sRGB 通道分别扩散，系数 7/16、3/16、5/16、1/16，蛇形扫描），每像素用 15-bit RGB LUT（32768 项，每换色板重建一次）查最近可用色；随后按格采样。
3. **格采样**：每格区域按上游同款规则取整（start=floor(i×cellW)，end=min(w, ceil((i+1)×cellW))）。主色模式=区域内 alpha≥128 像素中出现频率最高的 RGB（平票取先出现者）；平均色模式=平均值取整。区域内无 alpha≥128 像素 → 透明格。
4. **匹配**：Oklab 感知距离（上游公式，×100 尺度）找最近可用色；品牌色板中该 hex 无对应色号（"-"）的颜色视为不可用，不可用色被匹配后改配最近可用色。
5. **合并**：按目标颜色数 K 贪心合并。颜色按频率降序；二分查找最小阈值 θ∈[0,60]，使「Oklab 距离 < θ 的低频色并入高频色」后 distinct ≤ K（或取可达最小值）；K ≥ 初始 distinct 时不合并。
6. **背景去除（可选，仅照片模式）**：从边界格洪泛，连通且与当前色 Oklab 距离 < τ 的格标记为「外部」，外部格不计入用量、预览显示浅灰、导出时透明。
7. **输出**：`pattern`（含 hex、品牌色号、transparent 标记）+ 各色用量统计。

### F5 编辑（工作台）

- 工具：画笔（1×1/2×2/3×3）、橡皮、油漆桶（连通区域）、吸管、全局替换（色号 A→色号 B，含「排除颜色」=替换为透明）、清除全部。
- 撤销/重做：操作栈（快照式，记录受影响格前后值），上限 100 步，超出丢最旧；生成/换参数/换图清空栈。
- 视图：滚轮/双指缩放 50%–1600%，空格+拖拽平移；悬停（桌面）/长按（移动）显示色号与颜色；可开关网格线与板缝线（29×29 加粗）。
- 编辑后色号用量统计实时更新；编辑器操作延迟 ≤ 50 ms/操作（200×200）。
- 移动端：点按绘制、长按吸色、橡皮/油漆桶可用；精细编辑建议桌面但移动端不设功能墙。

### F6 色板

- 内置五套国产色板（数据源：上游 `colorSystemMapping.json`，291 色 × 5 品牌；部分品牌对个别 hex 无对应色号记为 null）。
- 数据完整性要求（入库前程序化校验，作为测试断言）：291 个 hex 均为合法 `#RRGGBB` 且唯一；每品牌色号在其品牌内唯一（null 除外）。
- 自定义色板：用户可新建/重命名/编辑/删除，每色 = 色号（文本，≤20 字符）+ hex；每色板 ≤ 500 色；色号在板内唯一；hex 合法且不重复；随账号云端同步，最多 20 个。
- 品牌与自定义色板切换后重新生成图纸。

### F7 渲染与导出

**PNG 图纸**：
- 每格默认 24 px（可调 8–48）；色块 + 细网格线；板缝线（每 29 格）加粗；格子 ≥12 px 时标注色号（黑白自适应对比色）；「裁剪至内容」默认开（裁掉外部格包围盒）；可选「含图例」：图例块（色块+色号+数量）排布在图右侧。
- 输出上限：200×200×48 + 图例 ≈ 11000 px，用 Canvas 绘制后 `toBlob`；外部格不绘制（透明）。

**打印版 PDF**（pdf-lib，A4 纵向）：
- 分页拼图模式：每格 6 mm，每页 31 列 × 45 行（含 10 mm 页边距与页码区）；每页标注页坐标（第 x 页/共 n 页、行列区间）、板缝线、每格色号（4 pt）。
- 末页：完整图例 + 色号用量清单（色号、色块、数量、按数量降序）。
- 200×200 最坏情况 ≈ 35 页；导出前预览页数并确认。

**项目文件**（JSON，见 §5.3）：导出/导入；导入时校验 schema、尺寸上限、hex 合法性；hex 为准、色号仅展示（跨品牌导入可用）；导入后作为新设计打开。

**导出中断/失败**：所有导出在本地同步完成（≤ 2 s 量级），失败给出可重试的错误提示，不产生半成品文件。

### F8 保存与同步

- 本地（IndexedDB）：未登录也可保存设计（含项目 JSON + 缩略图 + 元数据）；本地库不设数量上限（受浏览器配额约束，写入失败提示）。
- 云端：登录后自动同步；每用户设计上限 100 个、单设计 JSON ≤ 5 MB（超出提示导出项目文件）。
- 同步模型：按 `updatedAt` 最后写入胜出（LWW），删除用墓碑记录；设备上线时拉取列表 diff 并推送本地变更；同步失败保留本地数据并显示「未同步」状态，可手动重试。
- 冲突不做 UI 合并（v1）；两设备同时编辑同一设计，较新的覆盖较旧的，并提示「已在其他设备更新」。
- 登出后本地数据保留（可继续离线编辑），重新登录后同步。

### F9 账号

- 注册：邮箱 + 密码（8–72 字符，不含首尾空白）；邮箱唯一（大小写不敏感）；发送验证邮件（24 h 有效，一次性）；验证前可登录但受限（提示验证、可重发）。
- 登录：邮箱 + 密码；会话 Cookie（HttpOnly/SameSite=Lax/Secure，30 天滚动）；速率限制 10 次/小时/IP 与 /邮箱，失败不泄露具体原因（统一「邮箱或密码错误」）。
- 找回密码：输入邮箱 → 发重置链接（1 h 有效，一次性）→ 设置新密码 → 旧会话全部失效。
- 修改密码：需当前密码。
- 注销账号：需密码确认；删除用户全部数据（设计、自定义色板、会话），不可恢复，二次确认。
- 邮件服务：腾讯云邮件推送（SES SMTP）；邮件模板含品牌名、操作链接、有效期说明。

### F10 引导与帮助

- 首次使用（无本地设计与会话）：首页显示三步引导（上传→调参→导出）。
- 帮助页：上传要求、参数说明（含抖动/颜色数/板缝线解释）、导出说明、常见问题（HEIC、透明底、大图、同步）。

### F11 页面与信息架构

`/`（首页：上传入口、引导、登录/注册入口）、`/app`（工作台：裁剪→参数→图纸→编辑→导出）、`/designs`（设计列表，需登录）、`/palettes`（色板管理，需登录）、`/login`、`/register`、`/verify-email`、`/forgot-password`、`/reset-password`、`/help`、`/about`（含开源声明与源码链接、备案号位置）。

### F12 响应式

- 断点：<768 px（手机）、768–1024 px（平板）、>1024 px（桌面）。
- 手机：上传（拍照/相册）、裁剪、参数、图纸查看、PNG 导出、PDF 导出可用；编辑可用基础工具。
- 桌面：完整编辑体验；工作台左右分栏（左图右参/工具）。

## 4. 领域模型与 API 契约

### 4.1 TypeScript 领域类型（`src/lib/` 共享）

```ts
type Brand = 'MARD' | 'COCO' | '漫漫' | '盼盼' | '咪小窝';
interface PaletteColor { hex: string; code: string | null; }   // hex: #RRGGBB
type SampleMode = 'dominant' | 'average';
interface GenerationParams {
  targetWidth: number;        // 20–200
  targetColorCount: number;   // 2–128
  dithering: boolean;
  mode: SampleMode;
  brightness: number;         // -100–100
  contrast: number;           // -100–100
  backgroundRemoval: boolean;
  bgTolerance: number;        // 0–40
}
interface PatternCell { hex: string | null; code: string | null; transparent: boolean; }
interface Pattern { width: number; height: number; cells: PatternCell[]; } // row-major
interface PatternStats { code: string; hex: string; count: number; }[]     // 降序
```

### 4.2 HTTP API（Next.js Route Handlers，`/api`）

| 方法/路径 | 说明 | 鉴权 |
|---|---|---|
| POST /api/auth/register | {email,password} → 204，发验证邮件 | 公开 |
| POST /api/auth/verify-email | {token} → 200，标记已验证 | 公开 |
| POST /api/auth/resend-verification | {email} → 204（防枚举恒返回） | 公开 |
| POST /api/auth/login | {email,password} → Set-Cookie | 公开 |
| POST /api/auth/logout | 清会话 | 会话 |
| GET /api/auth/me | {email, emailVerified, createdAt} | 会话 |
| POST /api/auth/forgot-password | {email} → 204 恒返回 | 公开 |
| POST /api/auth/reset-password | {token, password} → 204，失效全部旧会话 | 公开 |
| POST /api/auth/change-password | {currentPassword, newPassword} | 会话 |
| DELETE /api/auth/account | {password} → 删除账号及全部数据 | 会话 |
| GET /api/designs | 列表：[{id,name,width,height,updatedAt}] | 会话 |
| PUT /api/designs/:id | {name, project} upsert（id 客户端 UUID） | 会话 |
| GET /api/designs/:id | 完整项目 | 会话 |
| DELETE /api/designs/:id | 删除（墓碑） | 会话 |
| GET /api/palettes | 自定义色板列表 | 会话 |
| PUT /api/palettes/:id | upsert {name, colors[]} | 会话 |
| DELETE /api/palettes/:id | 删除 | 会话 |

- 错误约定：`{ error: { code: string; message: string } }`；HTTP 400 校验失败、401 未登录、403 未验证邮箱、404 不存在、409 冲突/超限、429 限流、500 服务错误（不泄露内部细节）。
- 校验：zod schema 为唯一事实来源，前后端共用。
- 限制：设计 ≤ 100/用户、JSON ≤ 5 MB、name ≤ 100 字符；色板 ≤ 20/用户、每板 ≤ 500 色。

## 5. 数据模型

### 5.1 PostgreSQL（Drizzle，`db/migrations/`）

```sql
users(id uuid pk, email citext unique not null, password_hash text not null,
      email_verified_at timestamptz, created_at, updated_at)
sessions(id uuid pk, user_id fk, token_hash text unique not null,
         expires_at timestamptz not null, created_at)
email_tokens(id uuid pk, user_id fk, purpose text not null,  -- verify|reset
             token_hash text unique not null, expires_at, used_at)
designs(id uuid pk, user_id fk not null, name text not null,
        project jsonb not null, updated_at, deleted_at)
palettes(id uuid pk, user_id fk not null, name text not null,
         colors jsonb not null, updated_at, deleted_at)
rate_limits(key text pk, count int, window_start timestamptz)
```

### 5.2 约束与索引

- 唯一：users.email(lower)、sessions.token_hash、email_tokens.token_hash。
- 索引：designs(user_id, deleted_at, updated_at desc)、palettes(user_id, deleted_at)。
- 外键级联：删除用户时级联删除 sessions/email_tokens/designs/palettes。

### 5.3 项目文件 JSON Schema（v1）

```json
{
  "format": "doupu-project", "version": 1,
  "name": "string ≤100",
  "createdAt": "ISO8601", "updatedAt": "ISO8601",
  "palette": { "kind": "builtin", "brand": "MARD" }
           | { "kind": "custom", "colors": [{"code": "string≤20", "hex": "#RRGGBB"}] },
  "params": { GenerationParams },
  "pattern": { "width": "20–200", "height": "20–200", "cells": [PatternCell...] }
}
```

导入规则：schema 严格校验；version 不支持的给出明确错误；hex 为准（cells.hex 缺失且非 transparent → 拒绝）；brand 未知 → 拒绝（提示更新版本）。

## 6. 边界情况清单（每项必须有对应测试）

| # | 类别 | 场景 | 预期行为 |
|---|---|---|---|
| E1 | 输入 | 0 字节文件 | 报「文件为空」 |
| E2 | 输入 | 损坏/截断的 JPEG/PNG | 报「无法解析该图片」，不崩溃 |
| E3 | 输入 | 改名 .jpg 的文本文件 | 按内容嗅探失败报错 |
| E4 | 输入 | 动画 GIF/APNG/WebP | 明确提示不支持动图 |
| E5 | 输入 | HEIC（Safari / Chrome） | 原生解码 / WASM 兜底成功；转码失败给出可操作提示 |
| E6 | 输入 | EXIF 旋转的 JPEG（1–8 方向） | 显示方向正确 |
| E7 | 输入 | 1×1 图片 | 可生成 1×1 图纸，不除零 |
| E8 | 输入 | 8000×8000 / >64M 像素 | 按上限拦截，提示裁剪 |
| E9 | 输入 | 极宽图（如 100:1） | 高度按比例 ≥1，正常生成 |
| E10 | 输入 | 全透明 PNG | 图纸全为透明格，导出为空图并提示 |
| E11 | 输入 | 半透明 PNG | alpha<128 视为透明，其余参与计算 |
| E12 | 输入 | 全白/全黑/纯色图 | 单色图纸正常生成 |
| E13 | 输入 | 16 位 PNG / CMYK JPEG / ICC | 按浏览器 sRGB 解码结果处理 |
| E14 | 参数 | W=20 / W=200 / W=0 / W=201 / 非整数 | 前两者正常；后三者 UI 层面无法输入，程序层 clamp/拒绝 |
| E15 | 参数 | K=2 / K=128 / K 大于实际颜色数 | 正常；不强制合并 |
| E16 | 参数 | 抖动开 + 全透明图 | 不产生 NaN，输出与关闭一致 |
| E17 | 参数 | 亮度/对比度极端值 | 输出仍为合法色，无越界 |
| E18 | 参数 | 背景去除 + 全图同色 | 全部标记外部，导出提示 |
| E19 | 色板 | 品牌含 "-" 缺失色号 | 该 hex 不可用，匹配改配最近可用色 |
| E20 | 色板 | 自定义色板 0 色 / 501 色 / 重复 hex / 非法 hex / 重复色号 | 全部拒绝并提示原因 |
| E21 | 编辑 | 撤销空栈 / 重做栈顶 / 100 步溢出 | 空操作 / 空操作 / 丢最旧 |
| E22 | 编辑 | 油漆桶点击外部格区域 | 仅填充同状态连通格 |
| E23 | 编辑 | 全局替换不存在的色号 / 替换为同一色号 | 提示无影响 / 幂等 |
| E24 | 编辑 | 编辑后全图透明 | 用量统计为 0，导出提示 |
| E25 | 导出 | 200×200 图纸 PDF 分页 | 页数正确（≤35 页），每页坐标正确，图例完整 |
| E26 | 导出 | 设计名为空 / 100 字符名 | 用默认名「未命名设计」/ 完整显示或截断（图例区） |
| E27 | 导出 | 含自定义色板（色号超长） | 图例/清单正常排版不溢出 |
| E28 | 账号 | 重复注册 / 大小写不同邮箱 | 提示已注册（统一文案） |
| E29 | 账号 | 未验证登录 → 受限接口 | 403 并提示验证；重发可用 |
| E30 | 账号 | 验证令牌过期 / 重用 / 伪造 | 统一「链接无效或已过期」，可重发 |
| E31 | 账号 | 密码 7/8/72/73 字符、首尾空白 | 边界通过（8/72），其余拒绝 |
| E32 | 账号 | 找回密码后旧会话 | 全部失效，需重新登录 |
| E33 | 账号 | 登录限流触发 | 429，提示稍后再试 |
| E34 | 账号 | 注销后 session / 数据 | 会话失效，数据级联删除 |
| E35 | 同步 | 离线保存 → 上线同步 | 自动推送，无丢失 |
| E36 | 同步 | 双设备同设计冲突 | LWW，较新覆盖，界面提示 |
| E37 | 同步 | 云端删除 → 本地离线再编辑 | 以 updatedAt 较新为准（可复活或再删，按时间裁定） |
| E38 | 同步 | 101 个设计 / >5 MB 项目 | 拒绝并提示（导出项目文件） |
| E39 | 存储 | IndexedDB 写入失败/配额满 | 提示保留本地会话数据不可保存，导出项目文件兜底 |
| E40 | UI | 移动端长按显示色号 / 触屏绘制 | 与桌面等效（对应手势） |
| E41 | UI | 高分屏（DPR 2/3）渲染 | 画布清晰，坐标换算正确 |

## 7. 非功能需求

### 7.1 性能预算

- 生成 200×200：≤ 2 s；编辑器单操作 ≤ 50 ms；首屏 LCP ≤ 2.5 s（首页）；导出 PNG（200×200×24）≤ 2 s；PDF（35 页）≤ 5 s。
- 内存：生成 200×200 峰值 ≤ 512 MB（含源图解码）。

### 7.2 安全

- argon2id 密码哈希；令牌哈希存储；Cookie HttpOnly/SameSite=Lax/Secure；CSP（'self' 为主，允许内联样式必要项单独白名单）；HSTS；X-Content-Type-Options；Caddy 层实现 TLS 1.2+。
- 速率限制（登录/注册/邮件）；所有输入 zod 校验；错误不泄露内部信息；SQL 参数化（Drizzle）。
- 部署密钥仅存服务器 .env，不进仓库；GitHub Secrets 仅 CI 用。

### 7.3 可访问性与体验

- 语义化 HTML、表单 label 齐全、按钮可键盘操作、颜色对比度 ≥ AA（正文）、图片 alt、焦点可见。
- 编辑器键盘：方向键移动选区（v1 基础支持），工具快捷键（B/E/G/I/替换，Ctrl+Z/Ctrl+Shift+Z）。

### 7.4 隐私与合规

- 原图不出本地；云端仅存图纸 JSON；隐私政策页说明数据范围与删除方式；账号注销即全量删除；页面底部展示备案号（上线后填入）与开源链接。

### 7.5 国际化预留

- 所有 UI 文案集中在 `src/messages/zh-CN.ts`，禁止散落硬编码字符串；导出物文案同源。

## 8. 测试策略（详见 ADR-0006）

- 单元：`src/lib` 每个模块对 §6 矩阵逐项断言 + 属性测试（随机输入不崩溃、结果在色板内）。
- API：route handler + 测试库（Postgres），覆盖 §4.2 全部端点与 E28–E34。
- E2E（Playwright，Chromium/Firefox/WebKit）：注册→验证→登录→上传→裁剪→生成→编辑→导出（PNG/PDF/项目文件）→保存→第二上下文同步；边界用例 E4/E5/E6/E10/E11 用检入的 fixture 文件。
- CI 门禁：lint → typecheck → unit → build → E2E，任一失败不得合并。
- 覆盖率：`src/lib` ≥ 90%。

## 9. 里程碑与交付物

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M1 基础与算法 | 脚手架、许可与标注、领域类型、色板数据与校验、解码、生成管线（含抖动/合并/背景）、参数面板、图纸渲染 | — |
| M2 编辑与导出 | 裁剪、编辑器（五工具+撤销重做）、PNG/PDF/项目文件导出与导入 | M1 |
| M3 账号与同步 | 数据库、认证全家桶、设计/色板 API、本地 IndexedDB、同步引擎、设计列表页 | M1 |
| M4 体验完善 | 响应式、引导、帮助页、设计列表 UI、色板管理 UI | M2+M3 |
| M5 交付 | E2E 套件、CI、Docker 部署与备份、备案/部署检查单、README、上线验收 | M4 |

交付物：源码（GitHub `doupu` 仓库，AGPL-3.0）、部署脚本与检查单、测试套件与报告、README（含用户文档与开发者文档）。

## 10. 验收标准（用户可核对）

1. 手机/桌面均可完成「传图→裁剪→调参→生成→编辑→导出 PNG/PDF/项目文件」全流程。
2. 五套品牌色板可选且色号与实豆一致（抽样对照上游数据与卖家色卡）。
3. 注册→邮件验证→登录→保存→换设备同步→注销全流程可用。
4. §6 边界情况矩阵全部有测试且通过；CI 全绿。
5. 部署检查单执行后可公网访问（HTTPS），页脚含备案号与开源链接。
6. 无 AI 功能、无广告、无支付入口。
