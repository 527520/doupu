# 02 豆社列表缩略图与详情页一致

Status: ready-for-human
Completion: complete

## 问题

列表卡片用 48×48 派生预览放大 4 倍画 canvas，模糊、过大且覆盖标题文字；用户要求列表就长成详情页那样（带格线与板缝线）。

## 交付

- `src/lib/render/png.ts` 纯 JS PNG 编码；`src/lib/render/thumbnail.ts` 光栅化（色块 + 细格线 + 板缝粗线，无色号）+ 进程内 LRU；`thumbnailSize.ts` 客户端/服务端共用尺寸规则。
- `GET /api/community/revisions/[id]/thumbnail`：公开修订 `immutable` 缓存；未公开修订仅作者与审核员可见、不缓存。
- `CommunityThumbnail` 组件替换豆社列表、首页货架、我的投稿、作品管理、审核队列中的 canvas；卡片图区固定正方形、图片不溢出。
- 详情页 OpenGraph 图复用同一 PNG。
