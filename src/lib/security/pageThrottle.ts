/**
 * 公开页面进程内节流（ADR-0021）：proxy 在渲染前按 IP 计每分钟请求数，超限直接 429。
 * 单实例部署（D26）下进程内 Map 足够；键数量有上限并定期清理，避免被海量伪造 IP 撑爆内存。
 */
export interface PageThrottle {
  /** 返回 null 表示放行；否则返回建议的 Retry-After 秒数。 */
  hit(ip: string, now?: number): number | null;
  size(): number;
}

export function createPageThrottle(options: { limitPerMinute: number; maxKeys?: number }): PageThrottle {
  const WINDOW_MS = 60_000;
  const maxKeys = options.maxKeys ?? 20_000;
  const buckets = new Map<string, { windowStart: number; count: number }>();
  let lastSweep = 0;
  const sweep = (now: number) => {
    if (now - lastSweep < WINDOW_MS && buckets.size < maxKeys) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
    // 仍然过多：丢掉最早的一半，宁可放过也不能让内存无限增长。
    if (buckets.size >= maxKeys) for (const key of [...buckets.keys()].slice(0, Math.ceil(buckets.size / 2))) buckets.delete(key);
  };
  return {
    hit(ip, now = Date.now()) {
      sweep(now);
      const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
      const bucket = buckets.get(ip);
      if (!bucket || bucket.windowStart !== windowStart) { buckets.set(ip, { windowStart, count: 1 }); return null; }
      bucket.count += 1;
      if (bucket.count <= options.limitPerMinute) return null;
      return Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
    },
    size: () => buckets.size,
  };
}

/** 需要页面级节流的公开路径：豆社列表与详情、sitemap。 */
export function isThrottledPublicPath(pathname: string): boolean {
  return pathname === '/community' || /^\/community\/[0-9a-f-]{36}$/iu.test(pathname) || pathname === '/sitemap.xml' || /^\/sitemap\/\d+\.xml$/u.test(pathname);
}
