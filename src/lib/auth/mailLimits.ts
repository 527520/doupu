/**
 * 发信成本防护（安全审查：SES 按量计费，发信接口=挂到公网上的钱）：
 * - 每邮箱每日上限（与 IP 无关）：分布式攻击换多少 IP 都卡在受害者邮箱这个键上；
 * - 每 IP 每小时总发信上限：单 IP 批量注册被封；
 * - 全局每日发信上限（MAIL_DAILY_SEND_LIMIT，默认 300）：兜底天花板。
 * 计数复用 db rate_limits 表（原子 UPSERT 递增），零新依赖。
 * 窗口：小时/天按服务器时间对齐（与 hourlyWindowStart 同风格）。
 */
import type { AnyDatabase } from '@/../db/client';
import { and, eq, sql } from 'drizzle-orm';
import { rateLimits } from '@/../db/schema';
import { checkRateLimit, hourlyWindowStart } from './rateLimit';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAIL_PER_EMAIL_DAILY = 5; // forgot 3 + resend 2 的余量由调用方细分
export const MAIL_PER_IP_HOURLY = 20;
export const MAIL_GLOBAL_DAILY_DEFAULT = 300;

export type MailLimitResult = 'ok' | 'emailLimited' | 'ipLimited' | 'globalLimited';
export interface MailLimitReservation {
  result: MailLimitResult;
  /** 发信未实际成功时调用；幂等地返还本次预占的三层配额。 */
  release(): Promise<void>;
}

/** 天对齐的窗口起点。 */
export function dailyWindowStart(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

function globalDailyLimit(): number {
  const raw = Number(process.env.MAIL_DAILY_SEND_LIMIT ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MAIL_GLOBAL_DAILY_DEFAULT;
}

/**
 * 依次检查三层限流；返回首个命中的限制类型，全过返回 'ok'。
 * 调用方语义：emailLimited → 静默 204（防枚举，见各路由注释）；
 * ipLimited/globalLimited → 统一 429（与具体邮箱无关，不泄露任何账号信息）。
 */
export async function checkMailSendLimits(
  db: AnyDatabase,
  opts: { email: string; ip: string; emailLimit?: number; now?: Date },
): Promise<MailLimitResult> {
  return (await reserveMailSendLimits(db, opts)).result;
}

/**
 * 原子计数仍在发信前完成以阻止并发超卖；调用方只在实际发送失败/未发送时 release，
 * 因而最终计数只代表真实成功发出的邮件。
 */
export async function reserveMailSendLimits(
  db: AnyDatabase,
  opts: { email: string; ip: string; emailLimit?: number; now?: Date },
): Promise<MailLimitReservation> {
  // 成本防护只应在存在真实发信成本时生效（配置了 SES 或 SMTP）。
  // 开发/E2E（无渠道，仅日志输出）不受限，避免测试环境被限流计数干扰。
  if (!process.env.SMTP_HOST && !process.env.SES_SECRET_ID) {
    return { result: 'ok', release: async () => undefined };
  }

  const now = opts.now ?? new Date();
  const email = opts.email.trim().toLowerCase();
  const emailLimit = opts.emailLimit ?? MAIL_PER_EMAIL_DAILY;
  const reservations: Array<{ key: string; windowStart: Date }> = [];

  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await db.transaction(async (tx) => {
      for (const reservation of reservations) {
        await tx
          .update(rateLimits)
          .set({ count: sql`greatest(${rateLimits.count} - 1, 0)` })
          .where(and(eq(rateLimits.key, reservation.key), eq(rateLimits.windowStart, reservation.windowStart)));
      }
    });
  };

  const limited = async (result: MailLimitResult): Promise<MailLimitReservation> => {
    await release();
    return { result, release };
  };

  // 每邮箱每日（键含邮箱，窗口=天）
  const emailKey = `mail:email:daily:${email}`;
  const dayStart = dailyWindowStart(now);
  reservations.push({ key: emailKey, windowStart: dayStart });
  if (!(await checkDailyLimit(db, emailKey, emailLimit, now))) return limited('emailLimited');

  // 每 IP 每小时（跨所有邮件类型）
  const ipKey = `mail:ip:hourly:${opts.ip}`;
  reservations.push({ key: ipKey, windowStart: hourlyWindowStart(now) });
  if (!(await checkRateLimit(db, ipKey, MAIL_PER_IP_HOURLY, now))) return limited('ipLimited');

  // 全局每日
  const globalKey = 'mail:global:daily';
  reservations.push({ key: globalKey, windowStart: dayStart });
  if (!(await checkDailyLimit(db, globalKey, globalDailyLimit(), now))) {
    return limited('globalLimited');
  }

  return { result: 'ok', release };
}

async function checkDailyLimit(
  db: AnyDatabase,
  key: string,
  limit: number,
  now: Date,
): Promise<boolean> {
  return checkRateLimit(db, key, limit, dailyWindowStart(now));
}
