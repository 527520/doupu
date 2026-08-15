/**
 * 邮件适配器（spec §F9）：
 * - 生产：腾讯云 SES SMTP（SMTP_HOST/PORT/USER/PASS/FROM 环境变量）；
 * - 未配置 SMTP：console 输出（dev，E2E 测试钩子读取链接）；
 * - 测试：读取 sentMails() 数组断言。
 * 所有发送的邮件同时入 sentMails（上限 100 条）供测试断言。
 */
import nodemailer from 'nodemailer';
import { DEV_MAIL_LINK_HEADER } from './mailMeta';
import { sendViaTencentSes } from './tencentSes';

export { DEV_MAIL_LINK_HEADER };

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const sent: Mail[] = [];

export function sentMails(): readonly Mail[] {
  return sent;
}

export function clearMailbox(): void {
  sent.length = 0;
}

// ---- 发信熔断器（成本防护）----
// SES/SMTP 发送失败（配额耗尽、服务异常）后 60 秒内所有发信请求统一快速失败，
// 不再向渠道发起调用，避免持续烧配额；单实例部署，进程内状态即可。
export const MAIL_CIRCUIT_COOLDOWN_MS = 60_000;
let mailCircuitOpenUntil = 0;

export function openMailCircuit(now: number = Date.now()): void {
  mailCircuitOpenUntil = now + MAIL_CIRCUIT_COOLDOWN_MS;
}

export function isMailCircuitOpen(now: number = Date.now()): boolean {
  return now < mailCircuitOpenUntil;
}

export function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

/** 是否开发邮件模式（非生产且未配置 SMTP）：邮件只打印到日志，不真实发送。 */
export function isDevMailMode(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST;
}

export function buildVerifyLink(token: string): string {
  return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export function buildResetLink(token: string): string {
  return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const mail: Mail = { to, subject, html, text };
  sent.push(mail);
  if (sent.length > 100) sent.shift();

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const { SES_SECRET_ID, SES_SECRET_KEY, SES_FROM } = process.env;
  try {
    if (SMTP_HOST) {
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT ?? 465),
        secure: Number(SMTP_PORT ?? 465) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transport.sendMail({ from: SMTP_FROM ?? SMTP_USER, to, subject, html, text });
      return;
    }
    if (SES_SECRET_ID && SES_SECRET_KEY && SES_FROM) {
      await sendViaTencentSes(
        {
          secretId: SES_SECRET_ID,
          secretKey: SES_SECRET_KEY,
          region: process.env.SES_REGION ?? 'ap-guangzhou',
          from: SES_FROM,
        },
        { to, subject, html, text },
      );
      return;
    }
    // dev：控制台输出（含验证/重置链接，供 E2E 钩子解析）
    console.log(`[dev-mail] to=${to} subject=${subject}\n${text}`);
  } catch (error) {
    if (SMTP_HOST || (SES_SECRET_ID && SES_SECRET_KEY)) {
      // 打开熔断器：60 秒内后续发信请求统一快速失败，不再烧配额
      openMailCircuit();
      // 只记录渠道类型，绝不落凭证/正文
      console.error('[mail] send failed via', SMTP_HOST ? 'smtp' : 'ses');
    }
    throw error;
  }
}
