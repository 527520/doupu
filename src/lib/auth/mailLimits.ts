/**
 * 发信成本防护（安全审查：SES 按量计费，发信接口=挂到公网上的钱）：
 * - 每邮箱每日上限（与 IP 无关）：分布式攻击换多少 IP 都卡在受害者邮箱这个键上；
 * - 每 IP 每小时总发信上限：单 IP 批量注册被封；
 * - 全局每日发信上限（MAIL_DAILY_SEND_LIMIT，默认 300）：兜底天花板。
 * 计数复用 db rate_limits 表（原子 UPSERT 递增），零新依赖。
 * 窗口：小时/天按服务器时间对齐（与 hourlyWindowStart 同风格）。
 */
import type { AnyDatabase } from '@/../db/client';
import { checkRateLimit } from './rateLimit';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAIL_PER_EMAIL_DAILY = 5; // forgot 3 + resend 2 的余量由调用方细分
export const MAIL_PER_IP_HOURLY = 20;
export const MAIL_GLOBAL_DAILY_DEFAULT = 300;

export type MailLimitResult = 'ok' | 'emailLimited' | 'ipLimited' | 'globalLimited';

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
  // 成本防护只应在存在真实发信成本时生效（配置了 SES 或 SMTP）。
  // 开发/E2E（无渠道，仅日志输出）不受限，避免测试环境被限流计数干扰。
  if (!process.env.SMTP_HOST && !process.env.SES_SECRET_ID) return 'ok';

  const now = opts.now ?? new Date();
  const email = opts.email.trim().toLowerCase();
  const emailLimit = opts.emailLimit ?? MAIL_PER_EMAIL_DAILY;

  // 每邮箱每日（键含邮箱，窗口=天）
  const emailKey = `mail:email:daily:${email}`;
  if (!(await checkDailyLimit(db, emailKey, emailLimit, now))) return 'emailLimited';

  // 每 IP 每小时（跨所有邮件类型）
  const ipKey = `mail:ip:hourly:${opts.ip}`;
  if (!(await checkRateLimit(db, ipKey, MAIL_PER_IP_HOURLY, now))) return 'ipLimited';

  // 全局每日
  if (!(await checkDailyLimit(db, 'mail:global:daily', globalDailyLimit(), now))) {
    return 'globalLimited';
  }

  return 'ok';
}

async function checkDailyLimit(
  db: AnyDatabase,
  key: string,
  limit: number,
  now: Date,
): Promise<boolean> {
  return checkRateLimit(db, key, limit, dailyWindowStart(now));
}
