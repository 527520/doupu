/**
 * 豆社公开内容节流与写操作限流（ADR-0021）。
 *
 * - 公开读接口按 IP 计小时窗口，复用 rate_limits 表；未知 IP（本机 / 无反代）不计，
 *   E2E 与本地开发因此不受影响，生产由 Caddy 注入 X-Real-IP。
 * - 写操作（点赞 / 举报 / 引用 / 投稿 / 原图上传 / 删评）按账号 + IP 各计一条；评论另有自己的四道闸门。
 * - 页面级节流在 proxy 里用进程内计数（见 pageThrottle.ts）。
 */
import type { AnyDatabase } from '@/../db/client';
import { checkRateLimit, clientIp, retryAfterSeconds } from '@/lib/auth/rateLimit';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';

export { retryAfterSeconds };

export type PublicReadRoute = 'works' | 'work' | 'comments' | 'thumbnail';

export function publicReadKey(route: PublicReadRoute, ip: string): string {
  return `public:${route}:${ip}`;
}

export async function enforcePublicReadLimit(db: AnyDatabase, request: Request, route: PublicReadRoute, now: Date = new Date()): Promise<void> {
  const ip = clientIp(request);
  if (ip === 'local') return;
  const allowed = await checkRateLimit(db, publicReadKey(route, ip), config.security.publicReadRateLimit, now);
  if (!allowed) throw new AppError('RATE_LIMITED', '访问过于频繁，请稍后再试');
}

export function communityWriteKeys(userId: string, ip: string): { user: string; ip: string | null } {
  return { user: `community:write:${userId}`, ip: ip === 'local' ? null : `community:write:ip:${ip}` };
}

export async function enforceCommunityWriteLimit(db: AnyDatabase, input: { userId: string; request: Request; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const keys = communityWriteKeys(input.userId, clientIp(input.request));
  const userAllowed = await checkRateLimit(db, keys.user, config.security.communityWriteRateLimit, now);
  const ipAllowed = keys.ip ? await checkRateLimit(db, keys.ip, config.security.communityWriteIpRateLimit, now) : true;
  if (!userAllowed || !ipAllowed) throw new AppError('RATE_LIMITED', '操作过于频繁，请稍后再试');
}
