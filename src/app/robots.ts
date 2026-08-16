import type { MetadataRoute } from 'next';

/** robots.txt（优化票 11）：允许收录，指向 sitemap。 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${base}/sitemap.xml`,
  };
}
