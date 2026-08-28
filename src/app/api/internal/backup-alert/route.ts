/**
 * POST /api/internal/backup-alert：备份容器失败告警入口（优化票 03）。
 * 服务端内部接口：以共享令牌鉴权（BACKUP_ALERT_TOKEN），不走浏览器 Origin 守卫
 * （调用方是 backup 容器，无浏览器 Origin）。
 * 生产启动已保证发信通道与管理员地址完整；只有显式 dev/test fake adapter 会仅记录日志。
 */
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { apiError, noContent, readJson, withApiErrors } from '@/lib/auth/http';
import { isDevMailMode, sendMail } from '@/lib/auth/mailer';
import { getDb } from '@/lib/auth/db';
import { checkRateLimit, clientIp } from '@/lib/auth/rateLimit';
import { config } from '@/lib/config';

const alertSchema = z.object({
  token: z.string().min(16),
  message: z.string().min(1).max(500),
});

/** 常量时间字符串比较（防时序侧信道猜令牌）。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

/** 单行化：告警内容进日志前剥掉换行与控制字符，避免伪造日志行（A-13）。 */
export function singleLine(message: string): string {
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

/** HTML 转义：告警内容会进管理员邮件正文，不能原样拼接（A-13）。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function post(request: Request) {
  // 该路径公网可达且不走浏览器 Origin 守卫：先按 IP 限流，令牌爆破才有代价（A-13）。
  const db = getDb();
  const allowed = await checkRateLimit(
    db,
    `internal:backup-alert:${clientIp(request)}`,
    config.security.backupAlertRateLimit,
  );
  if (!allowed) return apiError(new AppError('RATE_LIMITED', '请求过于频繁'));

  const body = await readJson(request, 4096);
  if (!body.ok) return body.response;
  const parsed = alertSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  const expected = process.env.BACKUP_ALERT_TOKEN ?? '';
  if (!expected || !safeEqual(parsed.data.token, expected)) {
    return apiError(new AppError('UNAUTHORIZED', '未授权'));
  }

  const message = singleLine(parsed.data.message);
  console.error('[backup-alert]', message);
  const adminEmail = process.env.ADMIN_EMAIL ?? process.env.SMTP_FROM ?? '';
  const sesAlertTemplateId = process.env.SES_ALERT_TEMPLATE_ID ?? '';
  // 告警通道是尽力而为的附加保障：SMTP 模式下由 sendMail 走 SMTP；
  // SES 模式但未建告警模板时降级为仅记日志（上面已落日志），不能让备份
  // 容器的告警调用把站点主流程拖垮，也绝不假报成功。
  if (adminEmail && !isDevMailMode() && (process.env.SMTP_HOST || sesAlertTemplateId)) {
    await sendMail(
      adminEmail,
      '豆谱备份告警',
      `<p>${escapeHtml(message)}</p>`,
      message,
      {
        sesTemplate: {
          templateId: sesAlertTemplateId,
          templateData: { message },
        },
      },
    );
  }
  return noContent();
}

export const POST = withApiErrors(post);
