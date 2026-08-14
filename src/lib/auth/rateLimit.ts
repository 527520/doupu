/**
 * 限流（spec §4.2 / ADR-0004）：按 key 每 1 小时窗口最多 limit 次。
 * 使用 db/incrementRateLimit 原子递增；窗口起点按小时对齐。
 */
import { incrementRateLimit, type Database } from '@/../db/client';

const WINDOW_MS = 60 * 60 * 1000;

/** 小时对齐的窗口起点（ISO）。 */
export function hourlyWindowStart(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/** 构造限流 key：路由 + IP + 邮箱（防跨账号与跨 IP 枚举）。 */
export function rateLimitKey(route: string, ip: string, email: string): string {
  return `auth:${route}:${ip}:${email.trim().toLowerCase()}`;
}

/** 提取客户端 IP（信任 x-forwarded-for 首项；本机回退 local）。 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'local';
}

/**
 * 递增计数并判定是否放行；返回 false 表示已超限（调用方回 429）。
 */
export async function checkRateLimit(
  db: Database,
  key: string,
  limit: number,
  now: Date = new Date(),
): Promise<boolean> {
  const count = await incrementRateLimit(db, key, hourlyWindowStart(now));
  return count <= limit;
}
