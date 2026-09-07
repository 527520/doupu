# 10 验证与收尾

Status: ready-for-agent
Completion: not-started

## 范围

- `npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:e2e`（Chromium / Firefox / WebKit）、`npm run build`。
- axe 零违规；350 / 390 / 768 / 1280 / 1440 五宽度截图（首页、豆社列表、详情、后台总览、审核台、官方批量、使用统计）无横向溢出，存 `evidence/`。
- `CONTEXT.md`：新增 D53（豆社节流与内容分级）、D54（用色纪律与豆粒按钮）、D55（评论不可编辑）、D56（后台总览与官方批量规格可选）；术语「评论发布时间」更新。
- `docs/adr/0021-community-public-throttling-and-tiering.md`、`docs/adr/0022-comment-editing-removed.md`。
- `verification.md`：前后对照与实际结果，不声称真机或生产验证。
