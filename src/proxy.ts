import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { buildContentSecurityPolicy } from '@/lib/security/csp';
import { createPageThrottle, isThrottledPublicPath } from '@/lib/security/pageThrottle';

// 进程内页面节流（ADR-0021）：阈值读环境变量而不是 config 模块，proxy 不应拖入完整配置与数据库依赖。
const pageLimit = Number.parseInt(process.env.RATE_PUBLIC_PAGE_IP_MINUTE ?? '', 10);
const throttle = createPageThrottle({ limitPerMinute: Number.isFinite(pageLimit) && pageLimit > 0 ? pageLimit : 120 });

function requestIp(request: NextRequest): string {
  return request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
}

export function proxy(request: NextRequest) {
  if (isThrottledPublicPath(request.nextUrl.pathname)) {
    const ip = requestIp(request);
    const retryAfter = ip === 'local' ? null : throttle.hit(ip);
    if (retryAfter !== null) {
      return new NextResponse('访问过于频繁，请稍后再试', { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
    }
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);

  // Next.js reads both request headers while rendering: x-nonce is available
  // to Server Components and CSP is parsed to nonce framework/RSC scripts.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  // Cross-origin isolation exposes SharedArrayBuffer so generation cancellation
  // can be observed from a busy worker without waiting for its event loop.
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
