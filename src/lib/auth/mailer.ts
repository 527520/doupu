/**
 * 邮件适配器（spec §F9）：
 * - 生产：腾讯云 SES SMTP（SMTP_HOST/PORT/USER/PASS/FROM 环境变量）；
 * - 未配置 SMTP：console 输出（dev，E2E 测试钩子读取链接）；
 * - 测试：读取 sentMails() 数组断言。
 * 所有发送的邮件同时入 sentMails（上限 100 条）供测试断言。
 */
import nodemailer from 'nodemailer';

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

export function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
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
  if (SMTP_HOST) {
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 465),
      secure: Number(SMTP_PORT ?? 465) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transport.sendMail({ from: SMTP_FROM ?? SMTP_USER, to, subject, html, text });
  } else {
    // dev：控制台输出（含验证/重置链接，供 E2E 钩子解析）
    console.log(`[dev-mail] to=${to} subject=${subject}\n${text}`);
  }
}
