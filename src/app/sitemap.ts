import { and, desc, eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';
import { communityRevisions, communityWorks } from '@/../db/schema';
import { getDb } from '@/lib/auth/db';

// Public works change at runtime and the production image is built without a
// database connection. Metadata routes are static by default in Next.js 16.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const routes = ['', '/app', '/palettes', '/community', '/community/rules', '/community/copyright', '/privacy', '/help', '/about'];
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: now,
    changeFrequency: route === '' || route === '/community' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : route === '/app' || route === '/community' ? 0.9 : 0.6,
  }));
  const works = await getDb().select({ id: communityWorks.id, updatedAt: communityWorks.updatedAt })
    .from(communityWorks)
    .innerJoin(communityRevisions, eq(communityRevisions.id, communityWorks.currentPublishedRevisionId))
    .where(and(eq(communityWorks.lifecycleStatus, 'active'), eq(communityRevisions.status, 'published')))
    .orderBy(desc(communityWorks.updatedAt));
  return [...staticEntries, ...works.map((work) => ({
    url: `${base}/community/${work.id}`,
    lastModified: work.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))];
}
