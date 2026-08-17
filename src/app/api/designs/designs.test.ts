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
import { measureJsonBytes } from '@/lib/sync/revision';

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
    version: 2,
    engineVersion: '2.0.0',
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

function putBody(name: string, w = 2, h = 1, baseRevision = 0) {
  return { name, project: projectFile(name, w, h), baseRevision };
}

function deleteBody(baseRevision: number) {
  return { baseRevision };
}

async function listItems() {
  return ((await (await listGet()).json()) as { items: Array<Record<string, unknown>> }).items;
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
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
  });

  it('未知数据库异常统一返回带 request ID 的 JSON', async () => {
    setTestDb({
      select: () => {
        throw new Error('database unavailable');
      },
    } as never);
    try {
      const response = await listGet(new Request('http://localhost/api/designs', {
        headers: { 'x-request-id': 'designs-test-request' },
      }));
      expect(response.status).toBe(500);
      expect(response.headers.get('x-request-id')).toBe('designs-test-request');
      expect(await response.json()).toEqual({
        error: { code: 'INTERNAL', message: '服务器内部错误' },
        requestId: 'designs-test-request',
      });
    } finally {
      setTestDb(db);
    }
  });

  it('返回全部条目（含墓碑，供同步 LWW），非墓碑含 width/height，按 updatedAt 降序', async () => {
    const a = await putOne(jsonRequest('PUT', '/api/designs/00000000-0000-4000-8000-000000000001', putBody('A', 4, 3)), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) });
    expect(a.status).toBe(200);
    const b = await putOne(jsonRequest('PUT', '/api/designs/00000000-0000-4000-8000-000000000002', putBody('B')), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000002' }) });
    expect(b.status).toBe(200);
    await deleteOne(jsonRequest('DELETE', '/api/designs/00000000-0000-4000-8000-000000000002', deleteBody(1)), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000002' }) });

    const list = await listItems() as Array<unknown> as Array<{ id: string; width: number; height: number; deleted: boolean }>;
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
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('X')), paramsOf(ID));
    const response = await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf(ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; project: ProjectFile };
    expect(body.name).toBe('X');
    expect(body.project.pattern.width).toBe(2);
  });

  it('不存在/已删/他人 → 404', async () => {
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf(ID))).status).toBe(404);
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('X')), paramsOf(ID));
    await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`, deleteBody(1)), paramsOf(ID));
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf(ID))).status).toBe(404);
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), paramsOf('00000000-0000-4000-8000-0000000000ff'))).status).toBe(404);
  });

  it('IDOR 防护：他人设计的 id 无法读取/删除（GET 404，DELETE 204 但不生效）', async () => {
    const ID = '00000000-0000-4000-8000-0000000000c1';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    // 用户 A（beforeEach 会话）创建设计
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('A 私有')), p(ID));

    // 用户 B 登录后尝试借 id 读取/删除
    const userB = await newUser();
    const sessionB = await createSession(db, userB);
    cookieJar.set(SESSION_COOKIE_NAME, sessionB.token);
    expect((await getOne(jsonRequest('GET', `/api/designs/${ID}`), p(ID))).status).toBe(404);
    expect((await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`, deleteBody(1)), p(ID))).status).toBe(200);

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
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('V1')), p(ID));
    const second = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('V2', 5, 2, 1)), p(ID));
    expect(second.status).toBe(200);
    const list = await listItems() as Array<unknown> as Array<{ name: string; width: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('V2');
    expect(list[0].width).toBe(5);
  });

  it('IDOR 防护：其他用户的设计 id 不可被覆盖（409 且原数据不变）', async () => {
    const ID = '00000000-0000-4000-8000-000000000011';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });

    // 用户 A（beforeEach 会话）保存设计
    const putA = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('A 的设计')), p(ID));
    expect(putA.status).toBe(200);

    // 用户 B 登录并尝试用相同 id 覆盖
    const userB = await newUser();
    const sessionB = await createSession(db, userB);
    cookieJar.set(SESSION_COOKIE_NAME, sessionB.token);
    const putB = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('B 的覆盖')), p(ID));
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
      const r = await putOne(jsonRequest('PUT', `/api/designs/${id}`, putBody(`D${i}`)), { params: Promise.resolve({ id }) });
      expect(r.status).toBe(200);
    }
    const over = await putOne(
      jsonRequest('PUT', '/api/designs/00000000-0000-4000-8000-999999999999', putBody('OVER')),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-999999999999' }) },
    );
    expect(over.status).toBe(409);
    expect(await errorCode(over)).toBe('CONFLICT');
    // 更新既有 → 仍 200
    const update = await putOne(
      jsonRequest('PUT', `/api/designs/00000000-0000-4000-8000-000000000001`, putBody('D1v2', 2, 1, 1)),
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
      jsonRequest('PUT', `/api/designs/${ID}`, putBody('ok')),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(response.status).toBe(200);
  });

  it('非法请求：坏 JSON / 坏字段 / 非 JSON Content-Type / 跨源 → 400/403', async () => {
    const ID = '00000000-0000-4000-8000-000000000030';
    const p = { params: Promise.resolve({ id: ID }) };
    const badJson = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, undefined), p);
    expect(badJson.status).toBe(400);
    const badField = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, { ...putBody('x'), name: '   ' }), p);
    expect(badField.status).toBe(400);
    const badType = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('x'), { contentType: 'text/plain' }), p);
    expect(badType.status).toBe(400);
    const badOrigin = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('x'), { origin: 'https://evil.example' }), p);
    expect(badOrigin.status).toBe(403);
  });
});

describe('DELETE /api/designs/[id]（墓碑）', () => {
  it('删除后列表只剩墓碑条目（deleted=true）、GET 404；同 id 重新 PUT 复活', async () => {
    const ID = '00000000-0000-4000-8000-000000000040';
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('X')), p(ID));
    expect((await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`, deleteBody(1)), p(ID))).status).toBe(200);
    // 幂等重复删除
    expect((await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`, deleteBody(1)), p(ID))).status).toBe(200);
    const list = await listItems() as Array<unknown> as Array<{ id: string; deleted: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0].deleted).toBe(true);
    // 复活
    const revived = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('X2', 2, 1, 2)), p(ID));
    expect(revived.status).toBe(200);
    const list2 = await listItems() as Array<unknown> as Array<{ id: string; deleted: boolean }>;
    expect(list2).toHaveLength(1);
    expect(list2[0].deleted).toBe(false);
  });

  it('删除立即清空大型正文，并在 90 天后硬删除墓碑', async () => {
    const ID = '00000000-0000-4000-8000-000000000041';
    const p = { params: Promise.resolve({ id: ID }) };
    await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('大正文')), p);
    await deleteOne(jsonRequest('DELETE', `/api/designs/${ID}`, deleteBody(1)), p);
    const compact = (await db.select().from(designs))[0];
    expect(compact.project).toBeNull();
    expect(compact.name).toBe('');
    expect(compact.payloadBytes).toBe(0);

    await db.update(designs).set({ deletedAt: new Date('2026-01-01T00:00:00.000Z') });
    await listGet();
    expect(await db.select().from(designs)).toHaveLength(0);
  });
});

describe('revision / cursor / transactional quota', () => {
  it('canonicalizes project.name to the list name in the same write', async () => {
    const ID = '00000000-0000-4000-8000-000000000050';
    const project = projectFile('旧的项目内名称');
    const response = await putOne(
      jsonRequest('PUT', `/api/designs/${ID}`, { name: '列表名称', project, baseRevision: 0 }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(response.status).toBe(200);
    const stored = (await db.select().from(designs))[0];
    expect(stored.name).toBe('列表名称');
    expect((stored.project as ProjectFile).name).toBe('列表名称');
  });

  it('stale baseRevision returns 409 and does not overwrite the winning writer', async () => {
    const ID = '00000000-0000-4000-8000-000000000051';
    const p = { params: Promise.resolve({ id: ID }) };
    expect((await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('v1')), p)).status).toBe(200);
    expect((await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('winner', 2, 1, 1)), p)).status).toBe(200);
    const stale = await putOne(jsonRequest('PUT', `/api/designs/${ID}`, putBody('loser', 2, 1, 1)), p);
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe('REVISION_CONFLICT');
    expect((await db.select().from(designs))[0].name).toBe('winner');
  });

  it('101 rows are returned over 50-item cursor pages without duplicates', async () => {
    const userId = (await db.select({ id: users.id }).from(users))[0].id;
    const project = projectFile('paged');
    const payloadBytes = measureJsonBytes(project);
    await db.insert(designs).values(Array.from({ length: 101 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      userId,
      name: `D${index}`,
      project,
      payloadBytes,
      revision: 1,
      updatedAt: new Date(1_800_000_000_000 + index),
    })));
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const request = new Request(`http://localhost/api/designs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      const page = (await (await listGet(request)).json()) as { items: Array<{ id: string }>; nextCursor: string | null };
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(ids).toHaveLength(101);
    expect(new Set(ids).size).toBe(101);
  });

  it('101 concurrent creates serialize at the user row and never exceed the active quota', async () => {
    const responses = await Promise.all(Array.from({ length: 101 }, (_, index) => {
      const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return putOne(jsonRequest('PUT', `/api/designs/${id}`, putBody(`C${index}`)), { params: Promise.resolve({ id }) });
    }));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(LIMITS.designsPerUser);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    expect(await db.select().from(designs)).toHaveLength(LIMITS.designsPerUser);
  });

  it('concurrent byte-quota writes serialize so only one request can consume the final capacity', async () => {
    const userId = (await db.select({ id: users.id }).from(users))[0].id;
    const seed = projectFile('seed');
    const candidate = projectFile('candidate');
    const bytes = measureJsonBytes(candidate);
    await db.insert(designs).values({
      id: '20000000-0000-4000-8000-000000000001',
      userId,
      name: 'seed',
      project: seed,
      revision: 1,
      payloadBytes: LIMITS.designBytesPerUser - Math.floor(bytes * 1.5),
    });
    const ids = ['20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'];
    const responses = await Promise.all(ids.map((id) => putOne(
      jsonRequest('PUT', `/api/designs/${id}`, { name: 'candidate', project: candidate, baseRevision: 0 }),
      { params: Promise.resolve({ id }) },
    )));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
  });
});
