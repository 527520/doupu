import type { MetadataRoute } from 'next';
import { getDb } from '@/lib/auth/db';
import { countSitemapWorks, sitemapPageCount, sitemapWindow } from '@/lib/community/sitemapWorks';

export const dynamic = 'force-dynamic';

/**
 * robots.txt（优化票 11）：允许收录，指向分页 sitemap（ADR-0021）。
 * 例外（批次 K）：/s/* 是只读分享链接——拿到链接才能看，属于私密内容。
 * 用户把链接发给朋友不代表愿意被搜索引擎收录，所以显式 Disallow
 * （页面自身也带 noindex，这里是第二道）。
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  let pages = 1;
  try { pages = sitemapPageCount(await countSitemapWorks(getDb()), sitemapWindow().pageSize); } catch { /* 数据库不可用时仍给出第一页 */ }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/s/', '/admin/', '/api/', '/community/mine', '/community/submit'] },
    sitemap: Array.from({ length: pages }, (_, id) => `${base}/sitemap/${id}.xml`),
  };
}
