import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/auth/db';
import { deleteSessionByToken } from '@/lib/auth/session';
import { clearSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { enforceMutatingGuard } from '@/lib/auth/guard';
import { withApiErrors } from '@/lib/auth/http';

/** 退出登录：幂等（无会话也返回 204），删除服务端会话并清除 Cookie。 */
async function post(request: Request): Promise<NextResponse> {
  // 与其他 mutating 端点一致：Origin 守卫防跨站强制登出（安全审查 P1）
  const guard = enforceMutatingGuard(request);
  if (guard) return guard;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (token) {
    await deleteSessionByToken(getDb(), token);
  }
  return new NextResponse(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie() },
  });
}

export const POST = withApiErrors(post);
