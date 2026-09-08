# 04 管理后台全链路

Status: ready-for-agent
Completion: not-started

## 范围

- 审核台：`PatternPreview variant="compact"`；`.review-material-pair` 等宽同顶；原图淡入；`.review-preview` 去掉垂直居中；空态顶部对齐。
- 人员：确认输入 + 角色选择放 `.form-row`，按钮独立一行右对齐；反馈就近。
- 作品 / 治理 / 标签 / 审计：尺寸统一、长链接缩短、Tags 空态给主动作、DailyDimensionTrend 补 header、`.admin-proof-grid` 三面板。
- 官方批次：`.batch-params-grid` 统一 36；工具条统一 44；卡片脚统一 32；确认弹窗 `dangerSolid`。
- 通用：`useAdminInspection.reload()` stale-while-revalidate；列表 skeleton 与错峰进场；总览卡按压反馈；`h3` 全局规则。

## 验收

- E2E 17：审核台图纸与原图 `boundingBox().y` 差 ≤ 2px；空态位于面板顶部。
