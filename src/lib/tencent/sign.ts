/**
 * 腾讯云 API 3.0 通用签名（TC3-HMAC-SHA256）。
 * SES 发信与文本内容安全（TMS）共用：SecretKey 只参与本地 HMAC 派生，绝不随请求发送。
 * 固定 POST / + JSON 请求体，签名头为 content-type;host。
 */
import { createHash, createHmac } from 'node:crypto';

export interface Tc3Request {
  service: string;
  host: string;
  action: string;
  version: string;
  region: string;
  secretId: string;
  secretKey: string;
  /** 已序列化的 JSON 请求体。 */
  payload: string;
  now?: Date;
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function buildTc3Request(input: Tc3Request): SignedRequest {
  const now = input.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8',
    `host:${input.host}`,
    '',
    'content-type;host',
    sha256Hex(input.payload),
  ].join('\n');
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    `${date}/${input.service}/tc3_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmacSha256(`TC3${input.secretKey}`, date);
  const secretService = hmacSha256(secretDate, input.service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');
  return {
    url: `https://${input.host}`,
    headers: {
      Authorization:
        `TC3-HMAC-SHA256 Credential=${input.secretId}/${date}/${input.service}/tc3_request, ` +
        `SignedHeaders=content-type;host, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': input.action,
      'X-TC-Version': input.version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': input.region,
    },
    body: input.payload,
  };
}
