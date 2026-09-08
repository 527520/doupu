# 05 豆社全链路

Status: ready-for-agent
Completion: not-started

## 范围

- 点赞软态 + `heart-pop` + 计数滚动；`liked === null` 不再灰态。
- CommunityFilters：DateRangePicker 替换双日期（`from` / `to` GET 参数不变）；`.form-row`；裸 RAC Button 改 Button。
- 卡片统一 `surface-card` + hover 上浮 + 错峰进场；预览区下沉井；空态 / 加载更多统一。
- CommunityMineActions 主次收敛，弹窗换 `useConfirm`。

## 验收

- `CommunityInteractions.test` / `CommunityMineActions.test` / `community/page.test` 通过；E2E 12 通过。
