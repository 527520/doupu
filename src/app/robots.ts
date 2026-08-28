import type { MetadataRoute } from 'next';

/**
 * robots.txt（优化票 11）：允许收录，指向 sitemap。
 * 例外（批次 K）：/s/* 是只读分享链接——拿到链接才能看，属于私密内容。
 * 用户把链接发给朋友不代表愿意被搜索引擎收录，所以显式 Disallow
 * （页面自身也带 noindex，这里是第二道）。
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/s/'] },
    sitemap: `${base}/sitemap.xml`,
  };
}
