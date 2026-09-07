# 06 后台外壳与共享组件

Status: ready-for-agent
Completion: not-started

## 目标

管理后台有统一的外壳、页头、双栏模板与共享组件；`/admin` 变为总览页；后台不弹统计同意横幅。

## 范围

- `AdminNav`：去 01–10 编号，模块加图标（`inbox/grid/list/flag/tag/chart/image/users/shield/info`），待办计数徽标（待审修订 / 待处理评论 / 待处理举报，由 `/api/admin/overview` 提供）；窄屏底栏保持。
- `AdminPageHeader`：眉题在上、标题居左、说明在下、动作靠右；替换全部 `admin-page-header` 用法，修复 flex 散开。
- `ListDetailLayout`（队列 + 详情 + 可选处置栏）、`Pagination`（上一页/下一页 + 页码）、`FilterBar`（表单行 + 查询/重置）、`StatusBadge`（走 `states.*`）、`ReasonPanel`（理由输入 + 确认句 + 危险按钮 + 取消）、后台 `EmptyState`。
- `/admin/page.tsx` 总览：四张计数卡（待审修订、待处理评论、待处理举报、系统告警）+ 快捷入口；`/api/admin/overview` 只读聚合。
- `AnalyticsConsent` 在 `/admin/**` 不渲染。
- 手机端 rail 品牌标与眉题重叠修复；`.admin-*` 样式重写（14px 基准、软面、明确分组）。

## 验收

- E2E `12/14/16/17` 后台用例通过（保留 `.admin-object-list button`、`.admin-page h1`、`.review-queue` 等选择器或同步更新）。
- axe 通过；350 宽无溢出。
