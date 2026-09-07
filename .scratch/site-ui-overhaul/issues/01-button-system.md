# 01 设计基础与按钮体系

Status: ready-for-agent
Completion: not-started

## 目标

全站按钮从「6 种 CSS 类 + 35 个无 class 按钮 + 8 个未定义的 `btn-ghost` + 6 处手写配方」收敛为一套有 React 层的按钮体系，并引入「豆粒」图标按钮。

## 范围

- 新建 `src/components/ui/Button.tsx`：`variant: primary | secondary | quiet | danger`，`size: sm | md`，`icon?: IconName`，`iconPosition`，`loading?`；渲染为 `<button>`（或 `as="a"`/`Link` 用于导航）。CSS 类名沿用 `.btn-primary / .btn-outline(=secondary) / .btn-quiet / .btn-danger`，保证现有 200+ 处 class 用法同步换新观感。
- 新建 `src/components/ui/IconButton.tsx`：圆形豆粒按钮（`.btn-bead`），必须 `aria-label`，支持 `pressed`（`aria-pressed`）与 `tone: neutral | primary | danger`。
- `globals.css`：重绘 `.btn-*`（去 3D 位移、统一圆角/描边/字重、`:focus-visible` 环），定义 `.btn-quiet`（并保留 `.btn-ghost` 为别名），定义 `.btn-bead`；补齐未定义 token（`--color-paper`、`--color-gold`、`--color-cream-border`）或替换为已有 token；`.notice` 去掉左侧圆角色条改为软底 + 前置图标位。
- `Icon.tsx` 新增：`trash`、`heart`、`heart-filled`、`flag`、`check`、`close`、`refresh`、`play`、`pause`、`stop`、`eye`、`tag`、`external`、`chevron-down/up/left/right`、`filter`、`calendar`、`image`、`copy`、`alert`、`inbox`、`users`、`shield`、`chart`、`list`、`minus`、`log-out`。
- 修复 6 处手写配方（`ConfirmDialog` 危险按钮、`PixelEditorCanvas` 三处、`Workbench` 取消下划线、`palettes/page.tsx` 编辑）并把评论区文字操作、色板行内操作改为 `IconButton`/quiet。

## 验收

- `rg "btn-ghost" src` 仅剩 CSS 别名；`rg 'className="underline' src` 为 0。
- 单测：`Button`/`IconButton` 渲染、禁用、pressed、aria-label 必填。
- E2E 全量通过（文案未变）。
