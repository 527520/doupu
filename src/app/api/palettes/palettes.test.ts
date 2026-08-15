/**
 * /api/palettes 路由测试（spec §4.2 + F6 限额；PGlite + next/headers mock）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { setTestDb } from '@/lib/auth/db';
import { users, sessions, palettes } from '@/../db/schema';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { GET as listGet } from './route';
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from './[id]/route';
import { LIMITS } from '@/lib/appInfo';
import type { CustomPaletteColor } from '@/lib/types';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  })),
}));

const ORIGIN = 'http://localhost:3000';

function jsonRequest(method: string, path: string, body?: unknown, opts: { origin?: string } = {}) {
  const headers = new Headers();
  headers.set('origin', opts.origin ?? ORIGIN);
  headers.set('content-type', 'application/json');
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const colors = (n: number): CustomPaletteColor[] =>
  Array.from({ length: n }, (_, i) => ({
    code: `C${i + 1}`,
    hex: `#${(0x010101 + i).toString(16).padStart(6, '0').toUpperCase()}`,
  }));

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestClient();
  setTestDb(db);
});

beforeEach(async () => {
  await db.delete(palettes);
  await db.delete(sessions);
  await db.delete(users);
  cookieJar.clear();
  const email = `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const rows = await db
    .insert(users)
    .values({ email, passwordHash: 'hash', emailVerifiedAt: new Date() })
    .returning();
  const session = await createSession(db, rows[0].id);
  cookieJar.set(SESSION_COOKIE_NAME, session.token);
});

describe('/api/palettes', () => {
  const p = (id: string) => ({ params: Promise.resolve({ id }) });

  it('未登录 401', async () => {
    cookieJar.clear();
    expect((await listGet()).status).toBe(401);
  });

  it('创建/列表/单个往返（含 colors）', async () => {
    const ID = '00000000-0000-4000-8000-0000000000a1';
    const created = await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: '我的色板', colors: colors(3) }), p(ID));
    expect(created.status).toBe(200);
    const list = (await (await listGet()).json()) as Array<{ id: string; name: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('我的色板');
    const one = (await (await getOne(jsonRequest('GET', `/api/palettes/${ID}`), p(ID))).json()) as { colors: CustomPaletteColor[] };
    expect(one.colors).toHaveLength(3);
  });

  it('20 上限 → 409；更新既有不受限', async () => {
    for (let i = 1; i <= LIMITS.palettesPerUser; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      expect((await putOne(jsonRequest('PUT', `/api/palettes/${id}`, { name: `P${i}`, colors: colors(1) }), p(id))).status).toBe(200);
    }
    const over = await putOne(
      jsonRequest('PUT', '/api/palettes/00000000-0000-4000-8000-999999999999', { name: 'OVER', colors: colors(1) }),
      p('00000000-0000-4000-8000-999999999999'),
    );
    expect(over.status).toBe(409);
    const update = await putOne(
      jsonRequest('PUT', '/api/palettes/00000000-0000-4000-8000-000000000001', { name: 'P1v2', colors: colors(2) }),
      p('00000000-0000-4000-8000-000000000001'),
    );
    expect(update.status).toBe(200);
  });

  it('501 色 → 400；非法 hex → 400', async () => {
    const ID = '00000000-0000-4000-8000-0000000000b1';
    const tooMany = await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: 'X', colors: colors(501) }), p(ID));
    expect(tooMany.status).toBe(400);
    const badHex = await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: 'X', colors: [{ code: 'A', hex: 'nope' }] }), p(ID));
    expect(badHex.status).toBe(400);
  });

  it('删除幂等 204；他人色板 404；删除后复活', async () => {
    const ID = '00000000-0000-4000-8000-0000000000b2';
    await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: 'X', colors: colors(1) }), p(ID));
    expect((await deleteOne(jsonRequest('DELETE', `/api/palettes/${ID}`), p(ID))).status).toBe(204);
    expect((await deleteOne(jsonRequest('DELETE', `/api/palettes/${ID}`), p(ID))).status).toBe(204);
    expect((await listGet()).status).toBe(200);
    expect(((await (await listGet()).json()) as unknown[]).length).toBe(0);
    expect((await getOne(jsonRequest('GET', `/api/palettes/${ID}`), p(ID))).status).toBe(404);
    expect((await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: 'X2', colors: colors(1) }), p(ID))).status).toBe(200);
  });

  it('IDOR 防护：其他用户的色板 id 不可被覆盖（409 且原数据不变）', async () => {
    const ID = '00000000-0000-4000-8000-0000000000b3';
    const created = await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: 'A 的色板', colors: colors(2) }), p(ID));
    expect(created.status).toBe(200);

    // 用户 B 登录并尝试用相同 id 覆盖
    const userB = (
      await db
        .insert(users)
        .values({ email: `b-${Math.random().toString(36).slice(2, 10)}@example.com`, passwordHash: 'hash', emailVerifiedAt: new Date() })
        .returning()
    )[0];
    const sessionB = await createSession(db, userB.id);
    cookieJar.set(SESSION_COOKIE_NAME, sessionB.token);
    const putB = await putOne(jsonRequest('PUT', `/api/palettes/${ID}`, { name: 'B 的覆盖', colors: colors(9) }), p(ID));
    expect(putB.status).toBe(409);

    const rows = await db.select().from(palettes);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('A 的色板');
    expect(rows[0].userId).not.toBe(userB.id);
  });
});
