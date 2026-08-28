/**
 * /api/designs/[id]/share 与 /s/[token] 的服务端契约（批次 K，决策 D38）。
 * 用 PGlite 真实数据库语义：token 只存哈希、快照固化、撤销后立即失效。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { setTestDb } from '@/lib/auth/db';
import { users, sessions, designs, designShares } from '@/../db/schema';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { hashToken } from '@/lib/auth/tokens';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { POST as sharePost, DELETE as shareDelete } from './route';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  })),
}));

const ORIGIN = 'http://localhost:3000';
const DESIGN_ID = '00000000-0000-4000-8000-0000000000a1';

function request(method: string): Request {
  const headers = new Headers();
  headers.set('origin', ORIGIN);
  headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}/api/designs/${DESIGN_ID}/share`, { method, headers, body: '{}' });
}

const routeParams = { params: Promise.resolve({ id: DESIGN_ID }) };

function project(name = '小熊'): ProjectFile {
  return {
    format: 'doupu-project',
    version: 2,
    engineVersion: '2.0.0',
    name,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    palette: { kind: 'builtin', brand: 'MARD' },
    params: DEFAULT_GENERATION_PARAMS,
    pattern: {
      width: 2,
      height: 1,
      cells: [
        { hex: '#FF0000', code: 'A', transparent: false },
        { hex: '#00FF00', code: 'B', transparent: false },
      ],
    },
  };
}

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await createTestClient();
  setTestDb(db);
});

beforeEach(async () => {
  await db.delete(designShares);
  await db.delete(designs);
  await db.delete(sessions);
  await db.delete(users);
  cookieJar.clear();
  const rows = await db
    .insert(users)
    .values({ email: `share-${Math.random().toString(36).slice(2, 8)}@example.test`, passwordHash: 'hash', emailVerifiedAt: new Date() })
    .returning();
  userId = rows[0].id;
  const session = await createSession(db, userId);
  cookieJar.set(SESSION_COOKIE_NAME, session.token);
  await db.insert(designs).values({
    id: DESIGN_ID,
    userId,
    name: '小熊',
    project: project(),
    payloadBytes: 100,
    revision: 1,
  });
});

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe('POST /api/designs/[id]/share', () => {
  it('未登录 401', async () => {
    cookieJar.clear();
    expect(await errorCode(await sharePost(request('POST'), routeParams))).toBe('UNAUTHORIZED');
  });

  it('返回可访问路径，库里只存 token 哈希（库泄露 ≠ 链接泄露）', async () => {
    const response = await sharePost(request('POST'), routeParams);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string; path: string };
    expect(body.path).toBe(`/s/${body.token}`);
    expect(body.token.length).toBeGreaterThanOrEqual(16);

    const rows = await db.select().from(designShares);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(body.token));
    // 明文 token 绝不能出现在库里
    expect(JSON.stringify(rows[0])).not.toContain(body.token);
  });

  it('快照固化：作者之后改了设计，已发出的链接内容不变', async () => {
    const first = (await (await sharePost(request('POST'), routeParams)).json()) as { token: string };
    await db.update(designs).set({ name: '改名了', project: project('改名了') }).where(eq(designs.id, DESIGN_ID));
    const rows = await db.select().from(designShares).where(eq(designShares.tokenHash, hashToken(first.token)));
    const snapshot = rows[0].snapshot as { name: string };
    expect(snapshot.name).toBe('小熊');
  });

  it('快照不含原图与生成参数（D13：原图不上云）', async () => {
    await sharePost(request('POST'), routeParams);
    const rows = await db.select().from(designShares);
    const serialized = JSON.stringify(rows[0].snapshot);
    expect(serialized).not.toContain('rgba');
    expect(serialized).not.toContain('params');
    expect(serialized).not.toContain('brightness');
  });

  it('重新分享会作废旧链接（一个设计只保留一条有效分享）', async () => {
    const first = (await (await sharePost(request('POST'), routeParams)).json()) as { token: string };
    const second = (await (await sharePost(request('POST'), routeParams)).json()) as { token: string };
    expect(second.token).not.toBe(first.token);
    const rows = await db.select().from(designShares);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(second.token));
  });

  it('别人的设计不能分享（越权返回 404，不泄露存在性）', async () => {
    const other = await db
      .insert(users)
      .values({ email: `other-${Math.random().toString(36).slice(2, 8)}@example.test`, passwordHash: 'h', emailVerifiedAt: new Date() })
      .returning();
    const otherSession = await createSession(db, other[0].id);
    cookieJar.set(SESSION_COOKIE_NAME, otherSession.token);
    expect(await errorCode(await sharePost(request('POST'), routeParams))).toBe('NOT_FOUND');
    expect(await db.select().from(designShares)).toHaveLength(0);
  });

  it('图纸数据缺失/损坏的设计不能分享（不发出打不开的链接）', async () => {
    // 用一个结构不完整的 project 覆盖：分享前的快照校验应当拒绝
    await db.update(designs).set({ project: { format: 'doupu-project' } }).where(eq(designs.id, DESIGN_ID));
    expect(await errorCode(await sharePost(request('POST'), routeParams))).toBe('VALIDATION');
    expect(await db.select().from(designShares)).toHaveLength(0);
  });

  it('跨站请求被守卫拦下', async () => {
    const headers = new Headers();
    headers.set('origin', 'http://evil.example');
    headers.set('content-type', 'application/json');
    const evil = new Request(`${ORIGIN}/api/designs/${DESIGN_ID}/share`, { method: 'POST', headers, body: '{}' });
    const response = await sharePost(evil, routeParams);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(designShares)).toHaveLength(0);
  });
});

describe('DELETE /api/designs/[id]/share', () => {
  it('撤销后记录消失，且幂等', async () => {
    await sharePost(request('POST'), routeParams);
    expect((await shareDelete(request('DELETE'), routeParams)).status).toBe(204);
    expect(await db.select().from(designShares)).toHaveLength(0);
    expect((await shareDelete(request('DELETE'), routeParams)).status).toBe(204);
  });

  it('未登录不能撤销别人的分享', async () => {
    await sharePost(request('POST'), routeParams);
    cookieJar.clear();
    expect(await errorCode(await shareDelete(request('DELETE'), routeParams))).toBe('UNAUTHORIZED');
    expect(await db.select().from(designShares)).toHaveLength(1);
  });
});
