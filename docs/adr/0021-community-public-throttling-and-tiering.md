# ADR-0021: 豆社公开内容按 IP 节流并分级，写操作补限流

- Status: accepted
- Date: 2026-09-07
- Refines: D32（配置化）, D34（安全追加）, D38（分享 noindex）, ADR-0004（限流表）, ADR-0020（评论四道闸门）

## Context

R12 复审发现豆社的公开面几乎没有反爬设计：列表 / 详情 / 评论 / 缩略图接口与 HTML 页面对任意 IP 不限速；
`sitemap.xml` 无上限地列出全部作品编号，等于一份全站清单；分页游标是明文 base64 JSON，可任意构造跳页；
详情页把完整图纸网格与色板 JSON 随 RSC 载荷发给匿名访客——图纸本身就是产品，拿到一个编号即可整张搬走。
写接口方面，评论有健全的四道闸门，但点赞、举报、引用、投稿、原图上传、删评没有任何限流；
重复检测的归一化没有剥离零宽字符。用户选择「节流 + 内容分级」，不引入第三方人机验证脚本。

## Decision

1. **页面级节流**：`proxy.ts` 对 `/community`、`/community/<uuid>`、`/sitemap/<n>.xml` 按 IP 计每分钟请求数（进程内计数、键数上限），
   超限直接 429 + `Retry-After`。单实例部署（D26）下进程内计数足够；阈值 `RATE_PUBLIC_PAGE_IP_MINUTE`。
2. **接口级节流**：豆社公开读接口（列表、详情、评论列表、未命中缓存的缩略图渲染）复用 `rate_limits` 表按 IP 计小时窗口，
   阈值 `RATE_PUBLIC_READ_IP_HOUR`；未知 IP（无反代）不计，生产由 Caddy 注入 `X-Real-IP`。所有 429 带 `Retry-After`。
3. **写操作限流**：点赞、举报、引用、投稿创建 / 提交、原图上传、删评按账号（`RATE_COMMUNITY_WRITE_USER_HOUR`）与 IP
   （`RATE_COMMUNITY_WRITE_IP_HOUR`）各计一条；评论仍走 ADR-0020 的闸门。
4. **内容分级**：匿名访客的详情页与 `GET /api/community/works/:id` 不再包含 `snapshot`（完整网格与色板），改为服务端渲染的
   大图（`thumbnail?size=large`，长边 1440、带格线与板缝、不带色号）+ 尺寸 / 用色 / 色带 / 标签；色号网格、交互查看器、
   「用这张制作」与评论发表需要登录。登录后的详情响应 `private, no-store`。
5. **sitemap 分页与截断**：只列最近 `SITEMAP_RECENT_DAYS` 天更新的作品，每页 `SITEMAP_PAGE_SIZE` 件，`robots.txt` 列出全部分页。
6. **游标签名**：豆社列表与评论分页游标以 HMAC-SHA256 签名（密钥由 `ANALYTICS_IP_HMAC_KEY` 派生专用子密钥），篡改即 `VALIDATION`。
7. **补漏**：评论归一化剥离 Unicode `Cf`（零宽 / 格式）字符；举报评论时校验所属作品仍为 active。

## Consequences

- 匿名访客仍能浏览、搜索与查看每件作品的成品观感，但拿不到可直接复用的色号数据；这是对「图纸即产品」的保护，
  也是登录的明确理由。搜索引擎收录的是标题、描述与大图，不受影响。
- 页面节流是进程内的：多实例部署时需改为共享存储（Redis / rate_limits 表）。
- 所有阈值可配置（D32）；默认值面向单用户正常浏览（每分钟 120 页、每小时 1200 次接口调用）远高于人类使用强度。
- 不做设备指纹、不引入第三方脚本，与 D14 / 隐私政策一致。
