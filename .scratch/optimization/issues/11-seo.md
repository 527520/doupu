# 11 SEO 包：OpenGraph/robots/sitemap + 清残留

Status: ready-for-agent

## 目标

1. **分享卡片与元数据**：`src/app/layout.tsx` 补 `metadataBase`（env `APP_URL`）、`openGraph`（标题/描述/站点名/缩略图）、`twitter` 卡片、`manifest`（含 name/themeColor）、`icons`；生成一张分享缩略图 `public/og.png`（用拼豆图纸元素，符合 D30 视觉）。
2. **robots.txt**：`src/app/robots.ts`（允许全部，指向 sitemap）。
3. **sitemap.xml**：`src/app/sitemap.ts`（静态页全部；`/app`、`/designs` 等登录态页面同样收录，无参数 URL）。
4. **清残留**：删除 public 下 file/globe/next/vercel/window.svg 脚手架文件。

## 边界

- APP_URL 未配置（开发）时 metadataBase 回退 localhost，不影响开发。
- 不收录含 `?id=`/`?new=` 的动态地址（sitemap 只列规范路径）。

## 验收

- 构建后访问 /robots.txt、/sitemap.xml 返回正确内容（本地 HTTP 校验）。
- 首页 HTML 含 og:title/og:image/twitter:card 标签（E2E 或 curl 断言）。
- 全量回归。

## 涉及文件

src/app/layout.tsx、src/app/robots.ts（新）、src/app/sitemap.ts（新）、public/og.png（新）、public/*.svg（删）、src/lib/appInfo.ts
