/**
 * 会话管理（ADR-0004）：令牌哈希查表、过期校验、30 天滚动续期（半程阈值续期）。
 * 契约：getSessionUserId() 供读取当前登录用户；
 * getVerifiedSessionUserId() 供数据类 API 使用——未验证邮箱的会话一律视为未授权。
 */
import { cookies } from 'next/headers';
import { and, eq, gt, ne } from 'drizzle-orm';
import { sessions, users } from '@/../db/schema';
import type { AnyDatabase } from '@/../db/client';
import { getDb } from './db';
import { generateToken, hashToken } from './tokens';
import { readSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './cookies';

const TTL_MS = SESSION_TTL_SECONDS * 1000;
/** 剩余有效期低于半程（15 天）才滚动续期，避免每次只读请求都写库。 */
const RENEW_THRESHOLD_MS = TTL_MS / 2;

/** 创建会话：返回明文令牌（仅此一次）与过期时间。 */
export async function createSession(
  db: AnyDatabase,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

/** 按令牌哈希删除单个会话。 */
export async function deleteSessionByToken(db: AnyDatabase, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** 删除用户的全部会话（找回密码后旧会话全失效，spec E32）。 */
export async function deleteAllUserSessions(db: AnyDatabase, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** 吊销用户除当前会话外的全部会话（修改密码后其他设备下线，安全自查 M4）。 */
export async function revokeOtherSessions(db: AnyDatabase, userId: string, keepToken: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(keepToken))));
}

/**
 * 从 Cookie 头解析令牌并解析会话（含阈值滚动续期）。
 * 返回 userId 或 null；会话不存在/已过期/用户不存在均返回 null。
 * requireVerified：要求用户邮箱已验证（未验证会话的调用按未登录处理）。
 */
export async function resolveSessionUserId(
  db: AnyDatabase,
  cookieHeader: string | null,
  now: Date = new Date(),
  opts: { requireVerified?: boolean } = {},
): Promise<string | null> {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await db
    .select({ sessionId: sessions.id, userId: sessions.userId, verified: users.emailVerifiedAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  if (rows.length === 0) return null;
  if (opts.requireVerified && !rows[0].verified) return null;
  // 半程阈值滚动续期：仅当剩余有效期不足 15 天时把过期时间前移 30 天
  if (rows[0].expiresAt.getTime() - now.getTime() < RENEW_THRESHOLD_MS) {
    const newExpiry = new Date(now.getTime() + TTL_MS);
    await db.update(sessions).set({ expiresAt: newExpiry }).where(eq(sessions.id, rows[0].sessionId));
  }
  return rows[0].userId;
}

/** 读取当前请求的登录用户 id（未登录/会话过期返回 null）。 */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  return resolveSessionUserId(getDb(), buildHeader(token));
}

/** 读取当前请求的已验证登录用户 id（数据类 API 统一入口，未验证视为未授权）。 */
export async function getVerifiedSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  return resolveSessionUserId(getDb(), buildHeader(token), new Date(), { requireVerified: true });
}

function buildHeader(token: string | null): string | null {
  return token === null ? null : `${SESSION_COOKIE_NAME}=${token}`;
}
