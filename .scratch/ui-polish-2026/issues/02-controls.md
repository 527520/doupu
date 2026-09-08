# 02 控件质感重做

Status: ready-for-agent
Completion: complete

## 范围

- 按钮：primary 微渐变 + `--shadow-primary` + 内高光，hover 上浮，active 90ms 收缩；禁用不再用 opacity。
- `.btn-bead` pressed 软态；`data-tone="primary"` 未按下不再粉边；`heart-pop` / 回弹。
- 字段统一配方（input-field / input-compact / admin 输入 / DateField / ResponsiveSelect / NumberField / Textarea / TagInput / search）。
- DatePicker / DateRangePicker 整块可点。
- SegmentedControl 滑块（`data-count` + `:has()`），去点，`showLabel` / `size="sm"`。
- Switch 弹簧、Checkbox 画勾、Chip 去点、Badge 描边。
- Modal 进场 + 遮罩模糊；Popover `pop-in`。
- 新 `ui/Menu.tsx`；`ActionOverflow` 改为其包装并迁移四处调用。
- EmptyState `align="start"`。

## 验收

- 单测：Modal / FormControls / ResponsiveSelect / CommunityInteractions / AccountMenu / SiteHeader 通过；新增 Menu.test。

## Comments

- 菜单没有改用 react-aria `Menu`：四处调用方与 E2E 03/04/06、SiteHeader/WorkbenchProjectBar 单测都依赖「子项是真实 <a>/<button>、面板 data-testid=site-overflow-panel、onNavigate(event, href) 离开保护」这一契约。改为保留 `ActionOverflow` 的子项模型，重做其表面（豆粒触发器、浮层 pop-in、44px 菜单项、危险语气、<hr> 分隔）并补方向键漫游，效果一致且不动契约。
