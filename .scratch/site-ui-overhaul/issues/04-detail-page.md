# 04 豆社详情页

Status: ready-for-human
Completion: complete

## 目标

详情页从「左图 + 右侧 10 段堆叠」改为三区：标题与动作行、图纸舞台 + 制作卡、评论区；评论删除加确认；评论列表分页；匿名/登录分级渲染。

## 范围

- `src/app/community/[id]/page.tsx`：
  - 顶部：返回链接、标题、作者与日期、精选徽标；动作行：`Button primary`「用这张制作」（匿名时为「登录后制作」）、`IconButton heart`（点赞，`aria-pressed`）、`IconButton flag`（举报）、更多。
  - 主区：图纸舞台（登录：`PatternPreview` 交互查看器；匿名：服务端大图 `<img>` + 登录提示）；右侧 280px「制作卡」：尺寸/用色/规格三格、色带、标签、许可一句、折叠版本信息。
  - 下区：评论（表单 + 列表，最大宽 680px），锁定态说明。
- `CommunityInteractions.tsx` 拆分：`WorkActions`（动作行）与 `WorkComments`（评论）；评论项操作改为 `IconButton`（删除=垃圾桶需 `useConfirm`，举报=旗）；评论列表游标分页（`?cursor=`，每页 30，「加载更多」）。
- `listCommunityComments` 改游标分页并返回 `nextCursor`。
- `.community-*` 样式重写；760px 以下单列。

## 验收

- E2E `12`、`14`、`17` 详情相关用例通过（文案不变或同步 `zh-CN.ts`）。
- 单测：分页、删除确认、匿名分支渲染。
