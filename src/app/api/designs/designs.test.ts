/**
 * /api/designs 路由测试（spec §4.2 + E38；PGlite 内存库 + next/headers mock）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { setTestDb } from '@/lib/auth/db';
import { users, sessions, designs } from '@/../db/schema';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { GET as listGet } from './route';
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from './[id]/route';
import { exceedsProjectLimit } from '@/lib/sync/limits';
import { LIMITS } from '@/lib/appInfo';
import type { ProjectFile } from '@/lib/types';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  })),
}));

const ORIGIN = 'http://localhost:3000';

function jsonRequest(method: string, path: string, body?: unknown, opts: { origin?: string; contentType?: string } = {}) {
  const headers = new Headers();
  headers.set('origin', opts.origin ?? ORIGIN);
  headers.set('content-type', opts.contentType ?? 'application/json');
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function projectFile(name: string, w = 2, h = 1): ProjectFile {
  return {
    format: 'doupu-project',
    version: 1,
    name,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T01:00:00.000Z',
    palette: { kind: 'builtin', brand: 'MARD' },
    params: DEFAULT_GENERATION_PARAMS,
    pattern: {
      width: w,
      height: h,
      cells: Array.from({ length: w * h }, () => ({ hex: '#000000', code: 'A', transparent: false })),
    },
  };
}

let db: TestDatabase;

async function newUser(): Promise<string> {
  const email = `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const rows = await db
    .insert(users)
    .values({ email, passwordHash: 'hash', emailVerifiedAt: new Date() })
    .returning();
  return rows[0].id;
}

beforeAll(async () => {
  db = await createTestClient();
  setTestDb(db);
});

beforeEach(async () => {
  await db.delete(designs);
  await db.delete(sessions);
  await db.delete(users);
  cookieJar.clear();
  const userId = await newUser();
  const session = await createSession(db, userId);
  cookieJar.set(SESSION_COOKIE_NAME, session.token);
});

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe('GET /api/designs（列表）', () => {
  it('未登录 401', async () => {
    cookieJar.clear();
    expect(await errorCode(await listGet())).toBe('UNAUTHORIZED');
  });

  it('空列表', async () => {
    const response = await listGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('返回全部条目（含墓碑，供同步 LWW），非墓碑含 width/height，按 updatedAt 降序', async () => {
    const a = await putOne(jsonRequest('PUT', '/api/designs/00000000-0000-4000-8000-000000000001', { name: 'A', project: projectFile('A', 4, 3) }), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) });
    expect(a.status).toBe(200);
    const b = await putOne(jsonRequest('PUT', '/api/designs/00000000-0000-4000-8000-000000000002', { name: 'B', project: projectFile('B') }), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000002' }) });
    expect(b.status).toBe(200);
    await deleteOne(jsonRequest('DELETE', '/api/designs/00000000-0000-4000-8000-000000000002'), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000002' }) });

    const list = (await (await listGet()).json()) as Array<{ id: string; width: number; height: number; deleted: boolean }>;
    expect(list).toHaveLength(2);
    const live = list.filter((d) => !d.deleted);
    const tomb = list.filter((d) => d.deleted);
    expect(live).toHaveLength(1);
    expect(live[0].width).toBe(4);
    expect(live[0].height).toBe(3);
    expect(tomb).toHaveLength(1);
    expect(tomb[0].id).toBe('00000000-0000-4000-8000-000000000002');
  });
});

describe('GET /api/designs/[id]', () => {
  const ID = '00000000-0000-4000-8000-00000000000a';
  const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

  it('完整项目往返', async () => {
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'X', project: projectFile('X') }), paramsOf(ID));
    const response = await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf(ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; project: ProjectFile };
    expect(body.name).toBe('X');
    expect(body.project.pattern.width).toBe(2);
  });

  it('不存在/已删/他人 → 404', async () => {
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf(ID))).status).toBe(404);
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'X', project: projectFile('X') }), paramsOf(ID));
    await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`), paramsOf(ID));
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf(ID))).status).toBe(404);
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf('00000000-0000-4000-8000-0000000000ff'))).status).toBe(404);
  });

  it('IDOR 防护：他人设计的 id 无法读取/删除（GET 404，DELETE 204 但不生效）', async () => {
    const ID = '00000000-0000-4000-8000-0000000000c1';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    // 用户 A（beforeEach 会话）创建设计
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'A 私有', project: projectFile('A 私有') }), p(ID));

    // 用户 B 登录后尝试借 id 读取/删除
    const userB = await newUser();
    const sessionB = await createSession(db, userB);
    cookieJar.set(SESSION_COOKIE_NAME, sessionB.token);
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), p(ID))).status).toBe(404);
    expect((await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`), p(ID))).status).toBe(204);

    // A 的数据完好无损
    const rows = await db.select().from(designs);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('A 私有');
  });
});

describe('PUT /api/designs/[id]', () => {
  it('幂等 upsert：同 id 二次写入仍为一条（更新内容）', async () => {
    const ID = '00000000-0000-4000-8000-000000000010';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'V1', project: projectFile('V1') }), p(ID));
    const second = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'V2', project: projectFile('V2', 5, 2) }), p(ID));
    expect(second.status).toBe(200);
    const list = (await (await listGet()).json()) as Array<{ name: string; width: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('V2');
    expect(list[0].width).toBe(5);
  });

  it('IDOR 防护：其他用户的设计 id 不可被覆盖（409 且原数据不变）', async () => {
    const ID = '00000000-0000-4000-8000-000000000011';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });

    // 用户 A（beforeEach 会话）保存设计
    const putA = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'A 的设计', project: projectFile('A 的设计') }), p(ID));
    expect(putA.status).toBe(200);

    // 用户 B 登录并尝试用相同 id 覆盖
    const userB = await newUser();
    const sessionB = await createSession(db, userB);
    cookieJar.set(SESSION_COOKIE_NAME, sessionB.token);
    const putB = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'B 的覆盖', project: projectFile('B 的覆盖') }), p(ID));
    expect(putB.status).toBe(409);

    // A 的数据未被覆盖
    const rows = await db.select().from(designs);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('A 的设计');
    expect(rows[0].userId).not.toBe(userB);
  });

  it('100 上限：第 101 个 → 409；更新既有设计不受限', async () => {
    for (let i = 1; i <= LIMITS.designsPerUser; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const r = await putOne(jsonRequest('PUT', `/api/designs/${id}`, { name: `D${i}`, project: projectFile(`D${i}`) }), { params: Promise.resolve({ id }) });
      expect(r.status).toBe(200);
    }
    const over = await putOne(
      jsonRequest('PUT', '/api/designs/00000000-0000-4000-8000-999999999999', { name: 'OVER', project: projectFile('OVER') }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-999999999999' }) },
    );
    expect(over.status).toBe(409);
    expect(await errorCode(over)).toBe('CONFLICT');
    // 更新既有 → 仍 200
    const update = await putOne(
      jsonRequest('PUT', `/api/designs/00000000-0000-4000-8000-000000000001`, { name: 'D1v2', project: projectFile('D1v2') }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) },
    );
    expect(update.status).toBe(200);
  });

  it('超过 5 MB 的项目 → 400（体积守卫纯函数单测；schema 合法内容最大 ~2.5MB，API 层该分支为防御纵深）', async () => {
    const ID = '00000000-0000-4000-8000-000000000020';
    // 直接单测守卫函数：构造 5MB+ 与 5MB- 的对象
    const big = { name: 'x'.repeat(LIMITS.projectFileBytes) };
    expect(exceedsProjectLimit(big)).toBe(true);
    const small = { name: 'x'.repeat(100) };
    expect(exceedsProjectLimit(small)).toBe(false);
    // 确保 API 仍可正常工作（合法项目通过）
    const response = await putOne(
      jsonRequest('PUT', `/api/designs/${ID}`, { name: 'ok', project: projectFile('ok') }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(response.status).toBe(200);
  });

  it('非法请求：坏 JSON / 坏字段 / 非 JSON Content-Type / 跨源 → 400/403', async () => {
    const ID = '00000000-0000-4000-8000-000000000030';
    const p = { params: Promise.resolve({ id: ID }) };
    const badJson = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, undefined), p);
    expect(badJson.status).toBe(400);
    const badField = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: '   ', project: projectFile('x') }), p);
    expect(badField.status).toBe(400);
    const badType = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'x', project: projectFile('x') }, { contentType: 'text/plain' }), p);
    expect(badType.status).toBe(400);
    const badOrigin = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'x', project: projectFile('x') }, { origin: 'https://evil.example' }), p);
    expect(badOrigin.status).toBe(403);
  });
});

describe('DELETE /api/designs/[id]（墓碑）', () => {
  it('删除后列表只剩墓碑条目（deleted=true）、GET 404；同 id 重新 PUT 复活', async () => {
    const ID = '00000000-0000-4000-8000-000000000040';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'X', project: projectFile('X') }), p(ID));
    expect((await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`), p(ID))).status).toBe(204);
    // 幂等重复删除
    expect((await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`), p(ID))).status).toBe(204);
    const list = (await (await listGet()).json()) as Array<{ id: string; deleted: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0].deleted).toBe(true);
    // 复活
    const revived = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { name: 'X2', project: projectFile('X2') }), p(ID));
    expect(revived.status).toBe(200);
    const list2 = (await (await listGet()).json()) as Array<{ id: string; deleted: boolean }>;
    expect(list2).toHaveLength(1);
    expect(list2[0].deleted).toBe(false);
  });
});
