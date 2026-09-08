# 06 工作台 / 首页 / 色板 / 账号 / 登录

Status: ready-for-agent
Completion: not-started

## 范围

- 空白起稿：h2 + `.form-row`（色板 / 规格 / 板数分段）+ 摘要行 + 「创建空白图纸」主按钮；chip 不再直接创建；首页入口改次级 CTA 卡。
- 参数面板：高级选项 `Disclosure`；取样模式「主色 / 平均色」；range + compact NumberField；去 `mb-2` 漂移。
- 设计卡 / 最近设计 / 色板卡 `surface-card` + 错峰进场；SiteHeader 溢出改 Menu；AccountMenu 尺寸统一；登录 / 注册 `Button loading`。

## 验收

- `Workbench.test` / `DesignsView.test` / `AccountMenu.test` / `login.page.test` 通过；E2E 02 / 10 / 11 通过。
