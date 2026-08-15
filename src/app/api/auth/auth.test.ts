/**
 * 认证 API 全生命周期测试（spec §4.2；边界 E28–E34）。
 * 数据层使用 PGlite 内存库；邮件走 sentMails()；next/headers 的 cookies() 用可控 jar mock。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from '@/../db/testClient';
import { setTestDb } from '@/lib/auth/db';
import { clearMailbox, sentMails } from '@/lib/auth/mailer';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { POST as registerPost } from './register/route';
import { POST as verifyPost } from './verify-email/route';
import { POST as resendPost } from './resend-verification/route';
import { POST as loginPost } from './login/route';
import { POST as logoutPost } from './logout/route';
import { GET as meGet } from './me/route';
import { POST as forgotPost } from './forgot-password/route';
import { POST as resetPost } from './reset-password/route';
import { POST as changePasswordPost } from './change-password/route';
import { DELETE as accountDelete } from './account/route';

// ---------- next/headers cookies() mock ----------
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  })),
}));

// ---------- 测试工具 ----------
const ORIGIN = 'http://localhost:3000';

function post(path: string, body: unknown, opts: { ip?: string; origin?: string; contentType?: string; cookie?: string } = {}) {
  const headers = new Headers();
  headers.set('origin', opts.origin ?? ORIGIN);
  headers.set('content-type', opts.contentType ?? 'application/json');
  headers.set('x-forwarded-for', opts.ip ?? '192.0.2.1');
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function setCookieFromResponse(response: Response): string | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const m = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(header);
  return m ? m[1] : null;
}

function lastMail() {
  return sentMails()[sentMails().length - 1];
}

function tokenFromMail(mail: { text: string }): string {
  const m = /token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!m) throw new Error('mail 中未找到 token');
  return m[1];
}

async function errorBody(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; field?: string } };
}

const email = () => `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
const password = 'Passw0rd-测试';

beforeAll(async () => {
  setTestDb(await createTestClient());
});

beforeEach(() => {
  clearMailbox();
  cookieJar.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('认证全生命周期', () => {
  it('注册 → 验证 → 登录 → me → 修改密码 → 找回重置 → 旧会话失效 → 注销', async () => {
    const mail = email();

    // 1. 注册 → 204，发送验证邮件；开发邮件模式链接随响应头下发
    const reg = await registerPost(post('/api/auth/register', { email: mail, password }));
    expect(reg.status).toBe(204);
    expect(sentMails()).toHaveLength(1);
    expect(lastMail().to).toBe(mail);
    expect(lastMail().text).toContain('24 小时');
    expect(reg.headers.get('x-dev-mail-link')).toContain('/verify-email?token=');
    const verifyToken = tokenFromMail(lastMail());

    // 2. 重复注册（大小写变体）→ 409（E28）
    const dup = await registerPost(post('/api/auth/register', { email: mail.toUpperCase(), password }));
    expect(dup.status).toBe(409);
    expect((await errorBody(dup)).error.code).toBe('CONFLICT');

    // 3. 未验证登录：登录成功（200 + Cookie），但 me 受限 403（E29）
    const login1 = await loginPost(post('/api/auth/login', { email: mail, password }));
    expect(login1.status).toBe(200);
    const cookieHeader = login1.headers.get('set-cookie')!;
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    // Secure 仅生产附加（WebKit 拒绝 http://127.0.0.1 上的 Secure Cookie）；测试环境断言其缺失
    if (process.env.NODE_ENV === 'production') {
      expect(cookieHeader).toContain('Secure');
    } else {
      expect(cookieHeader).not.toContain('Secure');
    }
    expect(cookieHeader).toContain('Max-Age=2592000');
    const token1 = setCookieFromResponse(login1)!;
    expect(token1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    cookieJar.set(SESSION_COOKIE_NAME, token1);

    const meUnverified = await meGet();
    expect(meUnverified.status).toBe(403);
    expect((await errorBody(meUnverified)).error.message).toContain('邮箱未验证');

    // 4. 验证邮箱 → 200；me → 200
    const verify = await verifyPost(post('/api/auth/verify-email', { token: verifyToken }));
    expect(verify.status).toBe(200);
    const meOk = await meGet();
    expect(meOk.status).toBe(200);
    expect(await meOk.json()).toMatchObject({ email: mail, emailVerified: true });

    // 5. 令牌重用 → 统一「链接无效或已过期」（E30）
    const verifyReuse = await verifyPost(post('/api/auth/verify-email', { token: verifyToken }));
    expect(verifyReuse.status).toBe(400);
    expect((await errorBody(verifyReuse)).error.message).toContain('链接无效或已过期');
    // 伪造令牌
    const verifyFake = await verifyPost(post('/api/auth/verify-email', { token: 'A'.repeat(43) }));
    expect(verifyFake.status).toBe(400);

    // 6. 修改密码：错误当前密码 400；正确 204；旧密码登录失败、新密码成功
    const wrongChange = await changePasswordPost(
      post('/api/auth/change-password', { currentPassword: 'wrong-password', newPassword: 'NewPass-999' }),
    );
    expect(wrongChange.status).toBe(400);
    expect((await errorBody(wrongChange)).error.code).toBe('VALIDATION');

    const change = await changePasswordPost(
      post('/api/auth/change-password', { currentPassword: password, newPassword: 'NewPass-999' }),
    );
    expect(change.status).toBe(204);

    cookieJar.clear();
    const oldLogin = await loginPost(post('/api/auth/login', { email: mail, password }));
    expect(oldLogin.status).toBe(401);
    const newLogin = await loginPost(post('/api/auth/login', { email: mail, password: 'NewPass-999' }));
    expect(newLogin.status).toBe(200);
    cookieJar.set(SESSION_COOKIE_NAME, setCookieFromResponse(newLogin)!);

    // 7. 忘记密码（防枚举恒 204，E33）；开发邮件模式：存在的账号下发重置链接头，幽灵账号无头
    const forgot = await forgotPost(post('/api/auth/forgot-password', { email: mail }));
    expect(forgot.status).toBe(204);
    expect(forgot.headers.get('x-dev-mail-link')).toContain('/reset-password?token=');
    const resetToken = tokenFromMail(lastMail());
    const forgotGhost = await forgotPost(post('/api/auth/forgot-password', { email: 'ghost@example.com' }));
    expect(forgotGhost.status).toBe(204);
    expect(forgotGhost.headers.get('x-dev-mail-link')).toBeNull();
    expect(sentMails()).toHaveLength(2); // 不存在的邮箱不发信

    // 8. 重置密码 → 204；旧会话全部失效（E32）
    const reset = await resetPost(post('/api/auth/reset-password', { token: resetToken, password: 'ResetPass-111' }));
    expect(reset.status).toBe(204);
    const meAfterReset = await meGet();
    expect(meAfterReset.status).toBe(401);
    cookieJar.clear();
    const loginAfterReset = await loginPost(post('/api/auth/login', { email: mail, password: 'ResetPass-111' }));
    expect(loginAfterReset.status).toBe(200);
    cookieJar.set(SESSION_COOKIE_NAME, setCookieFromResponse(loginAfterReset)!);

    // 9. 退出登录 → 204 + 清除 Cookie；me → 401
    const logout = await logoutPost(post('/api/auth/logout', {}));
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    cookieJar.clear();
    expect((await meGet()).status).toBe(401);
  });

  it('注销账号：密码校验 → 级联删除 → 无法再登录（E34）', async () => {
    const mail = email();
    await registerPost(post('/api/auth/register', { email: mail, password }));
    const verifyToken = tokenFromMail(lastMail());
    await verifyPost(post('/api/auth/verify-email', { token: verifyToken }));

    const login = await loginPost(post('/api/auth/login', { email: mail, password }));
    cookieJar.set(SESSION_COOKIE_NAME, setCookieFromResponse(login)!);

    const wrong = await accountDelete(post('/api/auth/account', { password: 'wrong' }));
    expect(wrong.status).toBe(400);

    const del = await accountDelete(post('/api/auth/account', { password }));
    expect(del.status).toBe(204);
    expect(del.headers.get('set-cookie')).toContain('Max-Age=0');
    cookieJar.clear();

    const after = await loginPost(post('/api/auth/login', { email: mail, password }));
    expect(after.status).toBe(401);
  });

  it('重发验证邮件：存在未验证用户发信；不存在/已验证恒 204（防枚举）', async () => {
    const mail = email();
    await registerPost(post('/api/auth/register', { email: mail, password }));
    expect(sentMails()).toHaveLength(1);

    const resend = await resendPost(post('/api/auth/resend-verification', { email: mail }));
    expect(resend.status).toBe(204);
    expect(sentMails()).toHaveLength(2);

    const ghost = await resendPost(post('/api/auth/resend-verification', { email: 'ghost@example.com' }));
    expect(ghost.status).toBe(204);
    expect(sentMails()).toHaveLength(2);

    const badFormat = await resendPost(post('/api/auth/resend-verification', { email: 'not-an-email' }));
    expect(badFormat.status).toBe(400);
  });

  it('密码策略边界（E31）：7 字符拒绝、8 字符通过、首尾空白拒绝', async () => {
    const short = await registerPost(post('/api/auth/register', { email: email(), password: 'a'.repeat(7) }));
    expect(short.status).toBe(400);
    expect((await errorBody(short)).error.code).toBe('VALIDATION');

    const padded = await registerPost(post('/api/auth/register', { email: email(), password: ` ${'a'.repeat(8)}` }));
    expect(padded.status).toBe(400);

    const ok = await registerPost(post('/api/auth/register', { email: email(), password: 'a'.repeat(8) }));
    expect(ok.status).toBe(204);
  });

  it('登录限流：第 11 次返回 429（E33）', async () => {
    const mail = email();
    await registerPost(post('/api/auth/register', { email: mail, password }));
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await loginPost(post('/api/auth/login', { email: mail, password: 'wrong-password', ip: '198.51.100.7' }));
    }
    expect(last!.status).toBe(429);
    expect((await errorBody(last!)).error.code).toBe('RATE_LIMITED');
  });

  it('CSRF 防护：缺 Origin 403；非 JSON 400', async () => {
    const noOrigin = await registerPost(
      post('/api/auth/register', { email: email(), password }, { origin: '' }),
    );
    expect(noOrigin.status).toBe(403);

    const wrongType = await registerPost(
      post('/api/auth/register', { email: email(), password }, { contentType: 'text/plain' }),
    );
    expect(wrongType.status).toBe(400);
  });

  it('坏请求体：非法 JSON → 400 VALIDATION；错误响应不含内部细节', async () => {
    const bad = new Request('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: '{oops',
    });
    const res = await registerPost(bad);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('VALIDATION');
    expect(JSON.stringify(body)).not.toMatch(/at |SQL|stack|node_modules/);
  });

  it('会话表只存哈希（验收标准：库中无明文令牌）', async () => {
    const mail = email();
    await registerPost(post('/api/auth/register', { email: mail, password }));
    const login = await loginPost(post('/api/auth/login', { email: mail, password }));
    const token = setCookieFromResponse(login)!;
    const db = (await import('@/lib/auth/db')).getDb();
    const { sessions } = await import('@/../db/schema');
    const rows = await db.select().from(sessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false); // 明文绝不入库
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
  });
});
