import type { MetadataRoute } from 'next';
import { getDb } from '@/lib/auth/db';
import { countSitemapWorks, listSitemapWorks, sitemapPageCount, sitemapWindow } from '@/lib/community/sitemapWorks';

// Public works change at runtime and the production image is built without a
// database connection. Metadata routes are static by default in Next.js 16.
export const dynamic = 'force-dynamic';

/** 分页 sitemap（ADR-0021）：/sitemap/0.xml 含静态页 + 第一页作品，之后每页 SITEMAP_PAGE_SIZE 件；只列近期作品。 */
export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  let total = 0;
  // 开发环境的进程内 PGlite 对元数据路由不可见（仅 dev 现象；生产走 PostgreSQL 连接）：退回只有静态页的第一页。
  try { total = await countSitemapWorks(getDb()); } catch { total = 0; }
  return Array.from({ length: sitemapPageCount(total, sitemapWindow().pageSize) }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const page = Number.isInteger(id) && id >= 0 ? id : 0;
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = page !== 0 ? [] : ['', '/app', '/palettes', '/community', '/community/rules', '/community/copyright', '/privacy', '/help', '/about'].map((route) => ({
    url: `${base}${route}`,
    lastModified: now,
    changeFrequency: route === '' || route === '/community' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : route === '/app' || route === '/community' ? 0.9 : 0.6,
  }));
  let works: Array<{ id: string; updatedAt: Date }> = [];
  try { works = await listSitemapWorks(getDb(), page, now); } catch { works = []; }
  return [...staticEntries, ...works.map((work) => ({
    url: `${base}/community/${work.id}`,
    lastModified: work.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))];
}
