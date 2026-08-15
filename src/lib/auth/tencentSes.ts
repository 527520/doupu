/**
 * 腾讯云 SES（邮件推送）API 发信适配器。
 * 背景：个人实名用户不支持 SMTP 发信，官方保留 API 通道（SendEmail，版本 2020-10-02）。
 * 安全：TC3-HMAC-SHA256 签名——SecretKey 仅在本机做 HMAC 派生，绝不随请求传输；
 * 错误只上抛「错误码 + 官方 Message」，不包含任何凭证信息。
 */
import { createHash, createHmac } from 'node:crypto';

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

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * TC3-HMAC-SHA256 签名核心（可注入时间，便于用官方示例向量单测）。
 * 返回可直接 fetch 的请求对象；Host 头不显式设置——fetch 会自动生成，
 * 但签名仍按规范把 host 纳入 SignedHeaders。
 */
export function buildSesSendRequest(
  creds: SesCredentials,
  mail: OutgoingMail,
  now: Date = new Date(),
): { url: string; headers: Record<string, string>; body: string } {
  const payload = JSON.stringify({
    FromEmailAddress: creds.from,
    Destination: [mail.to],
    Subject: mail.subject,
    Simple: {
      // SES 要求 Html/Text 为 base64（错误码 InvalidParameterValue.EmailContentIsWrong）
      Html: Buffer.from(mail.html, 'utf8').toString('base64'),
      Text: Buffer.from(mail.text, 'utf8').toString('base64'),
    },
  });

  const timestamp = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10);

  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8',
    `host:${SES_HOST}`,
    '',
    'content-type;host',
    sha256Hex(payload),
  ].join('\n');

  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    `${date}/${SES_SERVICE}/tc3_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const secretDate = hmacSha256(`TC3${creds.secretKey}`, date);
  const secretService = hmacSha256(secretDate, SES_SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');

  return {
    url: `https://${SES_HOST}`,
    headers: {
      Authorization:
        `TC3-HMAC-SHA256 Credential=${creds.secretId}/${date}/${SES_SERVICE}/tc3_request, ` +
        `SignedHeaders=content-type;host, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': SES_ACTION,
      'X-TC-Version': SES_VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': creds.region,
    },
    body: payload,
  };
}

interface SesResponseBody {
  Response?: { Error?: { Code: string; Message: string }; RequestId?: string };
}

/**
 * 经 SendEmail API 发信；非 2xx 或业务错误上抛 Error（消息只含 code + 官方 Message）。
 */
export async function sendViaTencentSes(
  creds: SesCredentials,
  mail: OutgoingMail,
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
