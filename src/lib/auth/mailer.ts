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
import { resolveMailAdapter } from './runtimeConfig';

export { DEV_MAIL_LINK_HEADER };

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** SES 模板发信选项（个人用户仅模板模式可用；subject/html/text 供 SMTP/日志通道使用）。 */
export interface MailOptions {
  sesTemplate?: { templateId: string; templateData: Record<string, string> };
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

/** 是否开发邮件模式（非生产且未配置任何发信渠道）：邮件只打印到日志，不真实发送。
 * 安全自查 L4：SES 也算真实渠道——仅 SMTP 未配置就判定 dev 模式，
 * 会导致「测试环境配了 SES」时把验证链接经 x-dev-mail-link 响应头外泄。 */
export function isDevMailMode(): boolean {
  return resolveMailAdapter() === 'fake';
}

export function buildVerifyLink(token: string): string {
  return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export function buildResetLink(token: string): string {
  return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text: string,
  options?: MailOptions,
): Promise<void> {
  const mail: Mail = { to, subject, html, text };
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const { SES_SECRET_ID, SES_SECRET_KEY, SES_FROM } = process.env;
  const adapter = resolveMailAdapter();
  if (adapter !== 'fake' && isMailCircuitOpen()) {
    throw new Error('邮件通道暂时不可用，请稍后重试');
  }
  try {
    if (adapter === 'smtp') {
      const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT ?? 465),
        // 安全自查 L3：尊重显式 SMTP_SECURE 配置（true/1），否则按端口 465 推断
        secure:
          process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
            ? true
            : process.env.SMTP_SECURE === 'false' || process.env.SMTP_SECURE === '0'
              ? false
              : Number(SMTP_PORT ?? 465) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transport.sendMail({ from: SMTP_FROM ?? SMTP_USER, to, subject, html, text });
      recordSent(mail);
      return;
    }
    if (adapter === 'ses') {
      if (!SES_SECRET_ID || !SES_SECRET_KEY || !SES_FROM) throw new Error('SES adapter 配置不完整');
      const templateId = options?.sesTemplate?.templateId;
      if (!templateId) {
        throw new Error('SES 发信缺少模板 ID（SES_VERIFY_TEMPLATE_ID / SES_RESET_TEMPLATE_ID 未配置）');
      }
      await sendViaTencentSes(
        {
          secretId: SES_SECRET_ID,
          secretKey: SES_SECRET_KEY,
          region: process.env.SES_REGION ?? 'ap-guangzhou',
          from: SES_FROM,
        },
        { to, subject, templateId, templateData: options?.sesTemplate?.templateData ?? {} },
      );
      recordSent(mail);
      return;
    }
    // dev：控制台输出（含验证/重置链接，供 E2E 钩子解析）
    console.log(`[dev-mail] to=${to} subject=${subject}\n${text}`);
    recordSent(mail);
  } catch (error) {
    if (adapter !== 'fake') {
      // 打开熔断器：60 秒内后续发信请求统一快速失败，不再烧配额
      openMailCircuit();
      // 只记录渠道类型与错误摘要（code + 官方 Message），绝不落凭证/正文
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[mail] send failed via', SMTP_HOST ? 'smtp' : 'ses', ':', detail);
    }
    throw error;
  }
}

function recordSent(mail: Mail): void {
  sent.push(mail);
  if (sent.length > 100) sent.shift();
}
