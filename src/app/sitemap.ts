import type { MetadataRoute } from 'next';

/** sitemap.xml（优化票 11）：静态规范路径；登录态页面同样收录，不含动态参数。 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  const routes = ['', '/app', '/designs', '/palettes', '/help', '/about', '/login', '/register'];
  const now = new Date();
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: now,
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : route === '/app' ? 0.9 : 0.6,
  }));
}
