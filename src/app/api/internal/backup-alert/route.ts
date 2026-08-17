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

async function post(request: Request) {
  const body = await readJson(request, 4096);
  if (!body.ok) return body.response;
  const parsed = alertSchema.safeParse(body.data);
  if (!parsed.success) return apiError(parsed.error);

  const expected = process.env.BACKUP_ALERT_TOKEN ?? '';
  if (!expected || !safeEqual(parsed.data.token, expected)) {
    return apiError(new AppError('UNAUTHORIZED', '未授权'));
  }

  console.error('[backup-alert]', parsed.data.message);
  const adminEmail = process.env.ADMIN_EMAIL ?? process.env.SMTP_FROM ?? '';
  if (adminEmail && !isDevMailMode()) {
    // SMTP ignores the SES-specific option. In SES mode startup validation
    // guarantees a dedicated alert template; delivery failure must propagate
    // so the backup container never reports a false 204 success.
    await sendMail(
      adminEmail,
      '豆谱备份告警',
      `<p>${parsed.data.message}</p>`,
      parsed.data.message,
      {
        sesTemplate: {
          templateId: process.env.SES_ALERT_TEMPLATE_ID ?? '',
          templateData: { message: parsed.data.message },
        },
      },
    );
  }
  return noContent();
}

export const POST = withApiErrors(post);
