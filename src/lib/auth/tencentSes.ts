/**
 * 腾讯云 SES（邮件推送）API 发信适配器。
 * 背景：个人实名用户不支持 SMTP 发信，官方保留 API 通道（SendEmail，版本 2020-10-02）。
 * 安全：TC3-HMAC-SHA256 签名——SecretKey 仅在本机做 HMAC 派生，绝不随请求传输；
 * 错误只上抛「错误码 + 官方 Message」，不包含任何凭证信息。
 */
import { buildTc3Request } from '@/lib/tencent/sign';

export const SES_SERVICE = 'ses';
export const SES_HOST = 'ses.tencentcloudapi.com';
export const SES_VERSION = '2020-10-02';
export const SES_ACTION = 'SendEmail';

export interface SesCredentials {
  secretId: string;
  secretKey: string;
  /** 发信域名所在地区（控制台可见，默认广州）。 */
  region: string;
  /** 已验证的发信地址。 */
  from: string;
}

/**
 * 模板发信（个人实名用户无「自定义发送」权限，仅可用控制台创建的模板；
 * 错误码 FailedOperation.WithOutPermission）。模板变量键名与模板中 {{key}} 一致。
 * 注意：SendEmail 即使模板模式也强制要求 Subject 字段（MissingParameter）。
 */
export interface SesTemplateMail {
  to: string;
  subject: string;
  templateId: string;
  templateData: Record<string, string>;
}

/**
 * TC3-HMAC-SHA256 签名核心（可注入时间，便于用官方示例向量单测）。
 * 返回可直接 fetch 的请求对象；Host 头不显式设置——fetch 会自动生成，
 * 但签名仍按规范把 host 纳入 SignedHeaders。
 */
export function buildSesSendRequest(
  creds: SesCredentials,
  mail: SesTemplateMail,
  now: Date = new Date(),
): { url: string; headers: Record<string, string>; body: string } {
  // TemplateID 必须是 uint64 数字（InvalidParameter: input type should be uint64）
  const templateIdNum = Number(mail.templateId);
  if (!Number.isInteger(templateIdNum) || templateIdNum <= 0) {
    throw new Error(`SES 模板 ID 非法：${mail.templateId}`);
  }
  const payload = JSON.stringify({
    FromEmailAddress: creds.from,
    Destination: [mail.to],
    Subject: mail.subject,
    Template: {
      TemplateID: templateIdNum,
      // SES 约定：TemplateData 为 JSON 字符串
      TemplateData: JSON.stringify(mail.templateData),
    },
  });
  return buildTc3Request({
    service: SES_SERVICE, host: SES_HOST, action: SES_ACTION, version: SES_VERSION,
    region: creds.region, secretId: creds.secretId, secretKey: creds.secretKey, payload, now,
  });
}

interface SesResponseBody {
  Response?: { Error?: { Code: string; Message: string }; RequestId?: string };
}

/**
 * 经 SendEmail API（模板模式）发信；非 2xx 或业务错误上抛 Error（消息只含 code + 官方 Message）。
 */
export async function sendViaTencentSes(
  creds: SesCredentials,
  mail: SesTemplateMail,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { url, headers, body } = buildSesSendRequest(creds, mail);
  const response = await fetchImpl(url, { method: 'POST', headers, body });
  const result = (await response.json().catch(() => null)) as SesResponseBody | null;
  const error = result?.Response?.Error;
  if (!response.ok || error) {
    const code = error?.Code ?? `HTTP_${response.status}`;
    const message = error?.Message ?? '';
    throw new Error(`TencentSES ${code} ${message}`.trim());
  }
}
