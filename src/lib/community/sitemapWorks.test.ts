import { describe, expect, it } from 'vitest';
import { sitemapPageCount, sitemapWindow } from './sitemapWorks';
import { config } from '@/lib/config';

describe('sitemapWorks 纯函数', () => {
  it('窗口从 now 往回推配置天数，页大小取自安全配置', () => {
    const now = new Date('2026-09-11T08:00:00.000Z');
    const { since, pageSize } = sitemapWindow(now);
    expect(pageSize).toBe(config.security.sitemapPageSize);
    expect(now.getTime() - since.getTime()).toBe(config.security.sitemapRecentDays * 24 * 60 * 60 * 1000);
  });

  it('至少一页，按页大小向上取整', () => {
    expect(sitemapPageCount(0, 500)).toBe(1);
    expect(sitemapPageCount(501, 500)).toBe(2);
  });
});
