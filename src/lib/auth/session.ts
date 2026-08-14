/**
 * 会话管理（ADR-0004）：令牌哈希查表、过期校验、30 天滚动续期。
 * 契约：getSessionUserId() 供后续票（T16/T17 等）读取当前登录用户。
 */
import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import { sessions, users } from '@/../db/schema';
import type { Database } from '@/../db/client';
import { getDb } from './db';
import { generateToken, hashToken } from './tokens';
import { readSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './cookies';

const TTL_MS = SESSION_TTL_SECONDS * 1000;

/** 创建会话：返回明文令牌（仅此一次）与过期时间。 */
export async function createSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

/** 按令牌哈希删除单个会话。 */
export async function deleteSessionByToken(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** 删除用户的全部会话（找回密码后旧会话全失效，spec E32）。 */
export async function deleteAllUserSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * 从 Cookie 头解析令牌并解析会话（含滚动续期）。
 * 返回 userId 或 null；会话不存在/已过期/用户不存在均返回 null。
 */
export async function resolveSessionUserId(
  db: Database,
  cookieHeader: string | null,
  now: Date = new Date(),
): Promise<string | null> {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({ sessionId: sessions.id, userId: sessions.userId, userExists: users.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  if (rows.length === 0) return null;
  // 滚动续期：每次有效访问将过期时间前移 30 天
  const newExpiry = new Date(now.getTime() + TTL_MS);
  await db.update(sessions).set({ expiresAt: newExpiry }).where(eq(sessions.id, rows[0].sessionId));
  return rows[0].userId;
}

/**
 * 契约（供后续票）：读取当前请求的登录用户 id。
 * 未登录/会话过期返回 null；会话滚动续期。
 */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  return resolveSessionUserId(getDb(), buildHeader(token));
}

function buildHeader(token: string | null): string | null {
  return token === null ? null : `${SESSION_COOKIE_NAME}=${token}`;
}
