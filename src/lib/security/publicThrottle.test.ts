import { describe, expect, it } from 'vitest';
import { createPageThrottle, isThrottledPublicPath } from './pageThrottle';
import { signCursor, verifyCursor } from './cursor';
import { communityWriteKeys, publicReadKey } from './publicRateLimit';
import { retryAfterSeconds } from '@/lib/auth/rateLimit';
import { normalizeCommentText } from '@/lib/moderation/commentModeration';
import { sitemapPageCount } from '@/lib/community/sitemapWorks';

describe('页面级进程内节流', () => {
  it('同一分钟内超过阈值返回 Retry-After，窗口翻转后重新放行', () => {
    const throttle = createPageThrottle({ limitPerMinute: 3 });
    const base = Date.parse('2026-09-07T10:00:00Z');
    expect(throttle.hit('1.2.3.4', base)).toBeNull();
    expect(throttle.hit('1.2.3.4', base + 1000)).toBeNull();
    expect(throttle.hit('1.2.3.4', base + 2000)).toBeNull();
    const retry = throttle.hit('1.2.3.4', base + 3000);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect(throttle.hit('5.6.7.8', base + 3000)).toBeNull();
    expect(throttle.hit('1.2.3.4', base + 60_000)).toBeNull();
  });

  it('键数量有上限，海量伪造 IP 不会无限占用内存', () => {
    const throttle = createPageThrottle({ limitPerMinute: 10, maxKeys: 100 });
    const base = Date.parse('2026-09-07T10:00:00Z');
    for (let index = 0; index < 500; index += 1) throttle.hit(`10.0.${Math.floor(index / 250)}.${index % 250}`, base + index);
    expect(throttle.size()).toBeLessThanOrEqual(100);
  });

  it('只节流豆社列表 / 详情与 sitemap', () => {
    expect(isThrottledPublicPath('/community')).toBe(true);
    expect(isThrottledPublicPath('/community/5d7a4ccc-5aa1-405c-a6c5-3471e3b4f0d6')).toBe(true);
    expect(isThrottledPublicPath('/sitemap/0.xml')).toBe(true);
    expect(isThrottledPublicPath('/community/mine')).toBe(false);
    expect(isThrottledPublicPath('/app')).toBe(false);
  });
});

describe('游标签名', () => {
  it('签发后可验回原值，篡改载荷或签名即拒绝', () => {
    const token = signCursor({ sort: 'latest', id: 'abc' });
    expect(verifyCursor(token)).toEqual({ sort: 'latest', id: 'abc' });
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sort: 'latest', id: 'zzz' })).toString('base64url');
    expect(verifyCursor(`${forged}.${signature}`)).toBeNull();
    expect(verifyCursor(`${payload}.${signature.slice(0, -1)}x`)).toBeNull();
    expect(verifyCursor('not-a-cursor')).toBeNull();
    expect(verifyCursor(Buffer.from('{"id":1}').toString('base64url'))).toBeNull();
    expect(verifyCursor(null)).toBeNull();
  });
});

describe('限流键与 Retry-After', () => {
  it('公开读与写操作键按路由 / 账号 / IP 区分，未知 IP 不计', () => {
    expect(publicReadKey('works', '1.2.3.4')).toBe('public:works:1.2.3.4');
    expect(communityWriteKeys('user-1', '1.2.3.4')).toEqual({ user: 'community:write:user-1', ip: 'community:write:ip:1.2.3.4' });
    expect(communityWriteKeys('user-1', 'local').ip).toBeNull();
  });

  it('Retry-After 指向小时窗口结束', () => {
    expect(retryAfterSeconds(new Date('2026-09-07T10:59:30Z'))).toBe(30);
    expect(retryAfterSeconds(new Date('2026-09-07T10:00:00Z'))).toBe(3600);
  });
});

describe('评论归一化与 sitemap 分页', () => {
  it('零宽字符不能让同一句话看起来不同', () => {
    expect(normalizeCommentText('买\u200b家\u200d秒\uFEFF杀')).toBe(normalizeCommentText('买家秒杀'));
    expect(normalizeCommentText('  Hello　World ')).toBe('hello world');
  });

  it('sitemap 至少一页，按页大小向上取整', () => {
    expect(sitemapPageCount(0, 500)).toBe(1);
    expect(sitemapPageCount(500, 500)).toBe(1);
    expect(sitemapPageCount(501, 500)).toBe(2);
  });
});
