# 豆谱 2026 质感精修：柔和纵深 + 轻快必停

Status: ready-for-agent
Completion: in-progress（E2E 待在本地终端执行）
Baseline: b5c08e5

## 背景

前三轮（`site-ui-overhaul` / `site-visual-refinement` / `ui-refresh-acceptance`）把 token、无障碍、字体与控件骨架做对了，但表面层从未建立：所有面板是「白底 + 1px 实色灰边」、输入框只有边框、主按钮是纯色块、选中态一律实心莓果满填、禁用态用半透明、动效只有颜色过渡、按钮尺寸在同一行随意混搭、表单标签不锁高、`.review-preview` 把空态吊在屏幕中部、按钮文案最长 16 字。用户原话：「没有现代感，都 2026 年了还是丑的原始」。

用户拍板的方向：**柔和纵深**（保留现有配色，多层柔阴影建立层次、浅填充输入框、微渐变主按钮、滑块式分段控件）+ **轻快有弹性但必停**（按压 90ms、状态 180–220ms、进场 240–320ms 错峰、弹簧曲线只用于点赞/落位、绝不循环、尊重 reduced-motion）。

## 设计合同

### 层次（五级表面）

- 0 页面：`--color-cream`。
- 1 卡片：`#fff` + `--shadow-1` + 发丝边 `--color-hairline`（`rgb(41 38 51 / 8%)`）。
- 2 下沉井：`--color-surface-sunken` + `inset 0 0 0 1px hairline`，替代所有嵌套边框（预览区、`governance-body`、`admin-reason-panel`）。
- 3 浮层（popover / menu）：`--shadow-2`。
- 4 弹窗 / 底部面板：`--shadow-3` + 遮罩 `rgb(41 38 51 / 32%)` + `backdrop-filter: blur(6px)`。

阴影统一「环境 + 主光」双层暖墨：`--shadow-1` 静置、`--shadow-2` 悬浮、`--shadow-3` 模态、`--shadow-primary` 莓果投影、`--ring-focus` 焦点环。

### 尺寸律（同一行只允许一档）

- 表单行 44：输入 / 选择 / 日期 / 主次按钮。
- 工具行 36：`btn-sm`、Chip、`btn-bead-sm`、Checkbox、compact NumberField / Select / Switch。
- 密集行 32：仅批次卡片脚与表格行操作。
- 标签统一 `.field-label`：13px / 500 / ink-soft，`min-height: 1.25rem`，筛选行内不换行（省略号），保证同行控件底边对齐。
- 字段字号 15px，`pointer: coarse` 时 16px；标题三档：页 h1 28–32、区块 h2 18–20、面板条 / 子块 h3 15/600。

### 动效

- `--dur-press 90ms / --dur-fast 140ms / --dur-base 200ms / --dur-slow 320ms`；`--ease-out cubic-bezier(.22,1,.36,1)`；`--ease-spring cubic-bezier(.34,1.56,.64,1)` 只用于点赞 / 选中落位。
- 停止规则：单元素 ≤ 320ms；错峰 `animation-delay: calc(min(var(--i), 12) * 28ms)`，总时长 ≤ 700ms；`animation-fill-mode: both`；唯一允许循环的是加载指示（Spinner / skeleton）；`prefers-reduced-motion` 全部降级为即时。
- CSP：`style-src-attr 'unsafe-inline'` 允许 `style={{'--i': n}}`；禁止运行时注入 `<style>`，keyframes 只写在 `globals.css` / CSS Module。

## 票

- 01 token 与动效基建
- 02 控件质感重做
- 03 布局原语与尺寸律
- 04 管理后台全链路
- 05 豆社全链路
- 06 工作台 / 首页 / 色板 / 账号 / 登录
- 07 文案缩短
- 08 验证门禁

## 门禁

不降断言、不加跳过。`npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` 全量通过；E2E 17 视觉专项新增：分段滑块位移、日期字段整块点击、审核台图纸与原图顶边对齐、筛选行底边对齐、禁用主按钮不透明度为 1、空白起稿存在主按钮；五宽度 × 三浏览器截图到 `evidence/`；axe 零违规。只本地提交，不推送。

## 基线证据

用户提供的 15 张截图保留在会话附件；旧版截图在 `.scratch/site-visual-refinement/evidence/`。
