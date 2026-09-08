# 03 布局原语与尺寸律

Status: ready-for-agent
Completion: complete

## 范围

- `.form-row` / `.form-row-actions` 落地；FilterBar 与 analytics 查询按钮同行右对齐。
- 删除误伤日历按钮的 `.admin-analytics-filters button { align-self: end }`；`.admin-analytics-range` 改 `--col`。
- `.admin-back-to-queue` 改 `justify-self: start`；grid 直接子项的链接 / 按钮不再拉满宽。
- Notice / 确认弹窗 / 复选框 / ButtonLink 全部走组件。

## 验收

- E2E 17：筛选行控件底边差 ≤ 1px（1280 / 1440）。
