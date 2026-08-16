/**
 * 会话 Cookie 的序列化/解析（ADR-0004）：
 * doupu_session，HttpOnly / SameSite=Lax / Path=/，30 天滚动过期。
 * Secure 仅在生产（HTTPS）附加：WebKit 会在 http://127.0.0.1 上拒绝 Secure Cookie，
 * 导致开发/E2E 环境无法保持会话。
 */

import { config } from '@/lib/config';

function secureFlag(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

export const SESSION_COOKIE_NAME = 'doupu_session';
/** 会话时长（票 02 配置化：环境变量 SESSION_TTL_SECONDS，默认 30 天）。 */
export const SESSION_TTL_SECONDS = config.security.sessionTtlSeconds;

/** 序列化 Set-Cookie 值（供响应头使用）。 */
export function serializeSessionCookie(token: string, maxAgeSeconds: number = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secureFlag()}; Max-Age=${maxAgeSeconds}`;
}

/** 清除会话的 Set-Cookie 值。 */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secureFlag()}; Max-Age=0`;
}

/** 解析请求 Cookie 头 → Map（重复同名取第一个；无头返回空 Map）。 */
export function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !map.has(name)) map.set(name, value);
  }
  return map;
}

/** 从请求 Cookie 头中提取会话令牌。 */
export function readSessionToken(header: string | null): string | null {
  return parseCookieHeader(header).get(SESSION_COOKIE_NAME) ?? null;
}
