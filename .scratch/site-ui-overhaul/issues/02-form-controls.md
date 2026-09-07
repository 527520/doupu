# 02 表单控件补齐

Status: ready-for-human
Completion: complete

## 目标

消灭「原生控件裸用」：日期、数字、折叠、复选、计数文本域、芯片/徽标、空态都有品牌化控件。

## 范围

- `src/components/ui/DatePicker.tsx` 与 `DateRangePicker.tsx`：基于 `react-aria-components`（`DatePicker/DateRangePicker/Calendar/RangeCalendar`），中文月历（`I18nProvider locale="zh-CN"`），桌面锚定弹层、<768px 底部面板（复用 `ResponsiveSelect` 的面板样式），「清除 / 今天」快捷键，`value` 为 `YYYY-MM-DD` 字符串以兼容现有 URL 参数；原生 `input[type=date]` 只作无 JS 降级（`<noscript>` 或 `name` 隐藏输入）。
- `NumberField.tsx`：react-aria `NumberField`，带 −/+ 步进豆粒按钮，`min/max/step`。
- `Disclosure.tsx`：样式化折叠（react-aria `Disclosure/DisclosurePanel`），带 chevron 图标与 220ms 展开；保留 `<details>` 仅用于纯静态帮助页。
- `Checkbox.tsx`（含 `admin-check` 场景）、`Textarea.tsx`（计数 `N/500`）、`Chip.tsx`（筛选芯片，`aria-pressed`）、`Badge.tsx`（状态徽标 `tone: neutral|progress|ok|warn|danger`）、`EmptyState.tsx`（钉板纹理 + 标题 + 说明 + 可选动作）。
- 迁移：`CommunityFilters`、`AuditExplorer`、`admin/analytics` 的 3 处日期；`BatchParamsEditor`、`GenerationParamsPanel` 的 number；`CommunityFilters`「更多筛选」、`OfficialBatchStudio`、`ShoppingListPanel`、`PalettePicker` 等 details。

## 验收

- 单测：日期选择/清除/键盘/表单重置；NumberField 边界；Disclosure 展开与 aria。
- 现有 E2E（`13`、`17` 等对筛选表单的 `getByLabel`）继续通过。

## 交付备注

- 工作台 `GenerationParamsPanel` 的数字输入保留原生 `type=number`（E2E 与真机手感依赖即时提交），本轮只迁移官方批量、采购清单与标签排序处的数字输入；后续若替换需连带调整 E2E `fillField` 的提交时机。
- `Disclosure` 在未水合 / 无 JS 时渲染原生 `<details>`，GET 筛选降级用例因此保持通过。
