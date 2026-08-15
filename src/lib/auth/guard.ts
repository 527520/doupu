/**
 * 变更请求防护（ADR-0004 / spec §7.2）：
 * 所有 mutating 端点要求 Content-Type: application/json 且 Origin 受信。
 * Origin 判定：APP_URL 同源、ALLOWED_ORIGINS 白名单、或与请求自身 Host 同源
 * （浏览器同源请求的 Origin 恒等于页面自身来源，跨站攻击者无法伪造，CSRF 安全）。
 * 不满足时返回已构造好的错误响应；满足时返回 null。
 */
import { NextResponse } from 'next/server';
import { appUrl } from './mailer';

export function isOriginAllowed(origin: string | null, request?: Request): boolean {
  if (!origin) return false;
  try {
    const allowed = new URL(appUrl()).origin;
    if (origin === allowed) return true;
    if (request) {
      const host =
        request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
      if (host) {
        const proto = request.headers.get('x-forwarded-proto') ?? 'http';
        if (origin === `${proto}://${host}`) return true;
      }
    }
    const extra = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return extra.includes(origin);
  } catch {
    return false;
  }
}

/** 校验 mutating 请求；通过返回 null，否则返回错误响应。 */
export function enforceMutatingGuard(request: Request): NextResponse | null {
  if (!isOriginAllowed(request.headers.get('origin'), request)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: '请求来源不被允许' } },
      { status: 403 },
    );
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType) {
    // 完全未声明 Content-Type：视为无请求体的变更请求（如原生 bodyless DELETE），放行。
    // 本站客户端对所有 mutating 请求统一带 application/json（见 src/lib/sync/api.ts）。
    return null;
  }
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: '请求体必须为 application/json' } },
      { status: 400 },
    );
  }
  return null;
}
