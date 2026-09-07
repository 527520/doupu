import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 分页游标签名（ADR-0021）。此前游标是明文 base64 JSON，任何人都能构造任意
 * `publishedAt / id` 组合跳页遍历全站。签名后游标只能由服务端签发，篡改即拒绝。
 * 密钥由生产必填的 ANALYTICS_IP_HMAC_KEY 派生一个专用子密钥，不与其他用途混用原始密钥。
 */
function signingKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const root = env.ANALYTICS_IP_HMAC_KEY ?? (env.NODE_ENV === 'production' ? '' : 'doupu-local-analytics-hmac-key-not-for-production');
  if (root.length < 32) throw new Error('ANALYTICS_IP_HMAC_KEY is not configured');
  return createHmac('sha256', root).update('doupu-community-cursor-v1').digest();
}

function signature(payload: string, env?: NodeJS.ProcessEnv): string {
  return createHmac('sha256', signingKey(env)).update(payload).digest('base64url').slice(0, 22);
}

export function signCursor(value: unknown, env?: NodeJS.ProcessEnv): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${payload}.${signature(payload, env)}`;
}

/** 校验并解码；签名不符、格式损坏或 JSON 非法一律返回 null。 */
export function verifyCursor(token: string | null | undefined, env?: NodeJS.ProcessEnv): unknown | null {
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = signature(payload, env);
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
