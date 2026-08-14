/** 邮件模板（spec §F9）：纯函数，文案单一来源为 src/messages/zh-CN.ts 的 auth 命名空间。 */
import { zhCN } from '@/messages/zh-CN';

export interface MailTemplate {
  subject: string;
  html: string;
  text: string;
}

/** 验证邮件（默认 24 小时有效）。 */
export function verifyEmailTemplate(link: string, validHours = 24): MailTemplate {
  void validHours; // 有效期体现在文案中（zhCN.auth.verifyText/Html）
  return {
    subject: zhCN.auth.verifySubject,
    html: zhCN.auth.verifyHtml(link),
    text: zhCN.auth.verifyText(link),
  };
}

/** 重置密码邮件（默认 1 小时有效）。 */
export function resetPasswordTemplate(link: string, validHours = 1): MailTemplate {
  void validHours; // 有效期体现在文案中（zhCN.auth.resetText/Html）
  return {
    subject: zhCN.auth.resetSubject,
    html: zhCN.auth.resetHtml(link),
    text: zhCN.auth.resetText(link),
  };
}
