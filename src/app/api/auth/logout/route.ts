import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/auth/db';
import { deleteSessionByToken } from '@/lib/auth/session';
import { clearSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth/cookies';

/** 退出登录：幂等（无会话也返回 204），删除服务端会话并清除 Cookie。 */
export async function POST(): Promise<NextResponse> {
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
