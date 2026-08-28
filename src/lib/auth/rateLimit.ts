/**
 * 限流（spec §4.2 / ADR-0004）：按 key 每 1 小时窗口最多 limit 次。
 * 使用 db/incrementRateLimit 原子递增；窗口起点按小时对齐。
 */
import { incrementRateLimit, type AnyDatabase } from '@/../db/client';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';

const WINDOW_MS = 60 * 60 * 1000;

/** 小时对齐的窗口起点（ISO）。 */
export function hourlyWindowStart(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/** 构造限流 key：路由 + IP（+ 邮箱，防跨账号与跨 IP 枚举）。 */
export function rateLimitKey(route: string, ip: string, email = ''): string {
  return `auth:${route}:${ip}:${email.trim().toLowerCase()}`;
}

/**
 * 提取客户端 IP：
 * - 优先取反代注入的专用头 x-real-ip（若部署侧配置注入，见 deploy 文档）；
 * - 否则取 x-forwarded-for 首项。当前部署为单层反代（Caddy），XFF 不可信来源会被
 *   Caddy 覆盖；若未来接入 CDN，必须先在反代配置 trusted_proxies 后取「最后一个可信项」，
 *   否则攻击者可伪造 XFF 绕过限流（安全审查）。
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'local';
}

/**
 * 递增计数并判定是否放行；返回 false 表示已超限（调用方回 429）。
 */
export async function checkRateLimit(
  db: AnyDatabase,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<boolean> {
  const count = await incrementRateLimit(db, key, hourlyWindowStart(now));
  return count <= limit;
}

/** 同步写限流 key：按已鉴权用户计（同一账号换 IP 也受限）。 */
export function syncWriteKey(userId: string): string {
  return `sync:write:${userId}`;
}

/**
 * 同步写（设计/色板 PUT + DELETE）限流（A-12）。
 * 存量上限限制的是「总存储」，不限制「写入速率」：一个已验证账号可以反复 PUT
 * 约 5 MB 的 body，持续消耗解析 + 行锁。超限抛 RATE_LIMITED，由 withApiErrors 转 429。
 */
export async function enforceSyncWriteLimit(
  db: AnyDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const allowed = await checkRateLimit(db, syncWriteKey(userId), config.security.syncWriteRateLimit, now);
  if (!allowed) throw new AppError('RATE_LIMITED', '同步写入过于频繁，请稍后再试');
}
