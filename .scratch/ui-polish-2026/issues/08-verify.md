# 08 验证门禁

Status: ready-for-agent
Completion: not-started

## 范围

- 单测更新与新增（Menu、Segmented 滑块、DatePicker 整块点击、Button loading）。
- E2E 17 扩展：分段滑块位移、日期字段整块点击、审核台顶边对齐、筛选行底边对齐、禁用主按钮 opacity 为 1、空白起稿主按钮、reduced-motion 恒等变换保留。
- 五宽度 × 三浏览器截图到 `evidence/`；axe 零违规。
- `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`。
