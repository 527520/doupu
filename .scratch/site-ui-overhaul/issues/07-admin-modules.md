# 07 后台模块迁移

Status: ready-for-human
Completion: complete

## 目标

reviews / works / comments / reports / tags / users / audit / analytics / system 九个模块套用 06 的模板与 02 的控件。

## 范围

- `ReviewConsole`、`GovernanceConsole`：队列项加缩略图/状态徽标；处置栏用 `ReasonPanel`；空态用 `EmptyState`。
- `WorksManager`：筛选用 `FilterBar`；列表项状态徽标；批量打标区整理。
- `UsersManager`：列表不再把 UUID 当正文（显示名 + 角色徽标 + 掩码邮箱；编号进详情）。
- `TagsManager`、`AuditExplorer`：表格/列表统一；审计日期用 `DateRangePicker`。
- `admin/analytics`：筛选用 `DateRangePicker` 与 `ResponsiveSelect`；指标卡与图表面板统一。
- `admin/system`：任务卡与指标统一。

## 验收

- 所有后台 E2E 用例通过；五宽度截图无溢出；axe 通过。
