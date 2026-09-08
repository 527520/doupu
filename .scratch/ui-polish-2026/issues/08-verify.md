# 08 验证门禁

Status: ready-for-agent
Completion: in-progress

## 范围

- 单测更新与新增（Menu、Segmented 滑块、DatePicker 整块点击、Button loading）。
- E2E 17 扩展：分段滑块位移、日期字段整块点击、审核台顶边对齐、筛选行底边对齐、禁用主按钮 opacity 为 1、空白起稿主按钮、reduced-motion 恒等变换保留。
- 五宽度 × 三浏览器截图到 `evidence/`；axe 零违规。
- `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`。

## Comments

- lint / typecheck / 全量 vitest / 生产构建已通过；E2E 与截图对照因代理沙箱无法启动浏览器与稳定运行 dev 服务器而未在本机完成，见 [verification.md](../verification.md)。
- 第一轮 E2E（用户终端）27 个失败已逐个定位并修复：弹窗 / 抽屉 / 菜单入场不再动 transform、opacity、backdrop-filter；审核台并排改 subgrid 对位；紧凑下拉抽屉修掉「按下即开、松手误选」的真实 bug（`shouldSelectOnPressUp={false}`）；E2E 断言改在浏览器内解析矩阵；E2E 环境放开豆社写限流。第二轮 E2E 239 通过 / 12 失败，已再定位修复：高级选项折叠时不挂载（首次提交 50ms 预算）、axe 前等动效落定、日期字段捕获阶段开月历（修掉单测假阳性）、WebKit 抽屉入口先聚焦再打开、色板卡片 hover 不位移、Firefox 亚像素容差；firefox 02 取消 128ms 疑为时序噪声，待单独重跑确认。等待第三轮 E2E 结果。
