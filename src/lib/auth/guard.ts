/**
 * 变更请求防护（ADR-0004 / spec §7.2）：
 * 所有 mutating 端点要求 Content-Type: application/json 且 Origin 与 APP_URL 同源。
 * 不满足时返回已构造好的错误响应；满足时返回 null。
 */
import { NextResponse } from 'next/server';
import { appUrl } from './mailer';

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const allowed = new URL(appUrl()).origin;
    const extra = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return origin === allowed || extra.includes(origin);
  } catch {
    return false;
  }
}

/** 校验 mutating 请求；通过返回 null，否则返回错误响应。 */
export function enforceMutatingGuard(request: Request): NextResponse | null {
  if (!isOriginAllowed(request.headers.get('origin'))) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: '请求来源不被允许' } },
      { status: 403 },
    );
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: '请求体必须为 application/json' } },
      { status: 400 },
    );
  }
  return null;
}
