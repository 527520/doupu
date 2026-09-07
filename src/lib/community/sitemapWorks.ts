import { and, desc, eq, gte } from 'drizzle-orm';
import type { AnyDatabase } from '@/../db/client';
import { communityRevisions, communityWorks } from '@/../db/schema';
import { config } from '@/lib/config';

/**
 * sitemap 里的作品条目（ADR-0021）：只列最近 N 天更新的公开作品，并按固定页大小分页。
 * 此前一页无上限地列出全部作品编号，等于给爬虫一份全站清单。
 */
export function sitemapWindow(now: Date = new Date()): { since: Date; pageSize: number } {
  return { since: new Date(now.getTime() - config.security.sitemapRecentDays * 24 * 60 * 60 * 1000), pageSize: config.security.sitemapPageSize };
}

export async function countSitemapWorks(db: AnyDatabase, now: Date = new Date()): Promise<number> {
  const { since } = sitemapWindow(now);
  const rows = await db.select({ id: communityWorks.id }).from(communityWorks)
    .innerJoin(communityRevisions, eq(communityRevisions.id, communityWorks.currentPublishedRevisionId))
    .where(and(eq(communityWorks.lifecycleStatus, 'active'), eq(communityRevisions.status, 'published'), gte(communityWorks.updatedAt, since)));
  return rows.length;
}

export function sitemapPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export async function listSitemapWorks(db: AnyDatabase, page: number, now: Date = new Date()): Promise<Array<{ id: string; updatedAt: Date }>> {
  const { since, pageSize } = sitemapWindow(now);
  return db.select({ id: communityWorks.id, updatedAt: communityWorks.updatedAt }).from(communityWorks)
    .innerJoin(communityRevisions, eq(communityRevisions.id, communityWorks.currentPublishedRevisionId))
    .where(and(eq(communityWorks.lifecycleStatus, 'active'), eq(communityRevisions.status, 'published'), gte(communityWorks.updatedAt, since)))
    .orderBy(desc(communityWorks.updatedAt), communityWorks.id)
    .limit(pageSize).offset(Math.max(0, page) * pageSize);
}
