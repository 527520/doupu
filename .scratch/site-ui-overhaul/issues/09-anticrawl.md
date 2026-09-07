# 09 反爬与限流

Status: ready-for-agent
Completion: not-started

## 目标

公开内容按 IP 节流并分级，写接口补限流，堵住已发现的绕过点。

## 范围

- `src/lib/security/publicRateLimit.ts`：`enforcePublicReadLimit(db, ip, route)`（小时窗口，阈值 `config.security.publicReadRateLimit*`），超限抛 `RATE_LIMITED`；`withApiErrors` 对 429 附加 `Retry-After`。应用于：豆社列表 API 与 SSR、详情 API 与 SSR、评论列表、缩略图未命中缓存路径、sitemap。
- 写接口限流：点赞、举报、引用、投稿创建/提交、原图上传、删评论 → `community:write:${userId}`（每小时）+ IP 键。
- sitemap：只列近 `SITEMAP_RECENT_DAYS`（默认 180）天且每页 `SITEMAP_PAGE_SIZE`（默认 500），使用 sitemap index。
- 游标签名：`encodeCursor` 附 HMAC-SHA256（密钥由 `SESSION_SECRET` 派生），`decodeCursor` 校验失败即 `VALIDATION`。
- 归一化：`normalizeCommentText` 剥离 Cf 类（零宽/格式）字符；举报评论时校验作品 `active`。
- 内容分级：`getPublicCommunityWork` 增加 `includeSnapshot` 参数；`/api/community/works/[id]` 匿名不返回 `snapshot`；详情页匿名分支不传 pattern 给客户端，改用 `GET /api/community/revisions/[id]/thumbnail?size=large`（长边 1200，格线+板缝，无色号）。
- 配置项：`RATE_PUBLIC_READ_IP_HOUR`、`RATE_COMMUNITY_WRITE_USER_HOUR`、`SITEMAP_RECENT_DAYS`、`SITEMAP_PAGE_SIZE`；`.env.example` 与 `docs/` 部署说明同步。
- ADR-0021《豆社公开内容节流与分级》；CONTEXT.md 决策 D53。

## 验收

- 单测：限流键与窗口、游标签名/篡改拒绝、归一化、匿名 DTO 不含 snapshot、sitemap 分页。
- E2E：匿名详情页可见大图与统计且无色号网格；登录后可见交互查看器；`17` 首页/豆社用例通过。
