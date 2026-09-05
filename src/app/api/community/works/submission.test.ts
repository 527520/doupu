import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { communityRevisions, communityWorks, designs, idempotencyRecords, users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { POST as create } from './route';
import { POST as revise } from './[id]/revisions/route';
import { POST as submit } from '../revisions/[id]/submit/route';
import { POST as withdrawRevision } from '../revisions/[id]/withdraw/route';
import { POST as withdrawWork } from './[id]/withdraw/route';

let token: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));
let db: TestDatabase;
let designId: string;
let userId: string;
const request = (data: unknown, key = 'same-request') => new Request('http://localhost/api/community/works', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'idempotency-key': key }, body: JSON.stringify(data),
});
const input = () => ({ designId, expectedDesignRevision: 1, title: '公开标题', licenseVersion: COMMUNITY_LICENSE_VERSION });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(async () => {
  db = await createTestClient(); setTestDb(db);
  const [user] = await db.insert(users).values({ email: 'private@example.test', username: '小豆', emailVerifiedAt: new Date() }).returning();
  userId = user.id; token = (await createSession(db, userId)).token; designId = crypto.randomUUID();
  await db.insert(designs).values({ id: designId, userId, name: '私人内容', payloadBytes: 1, project: {
    format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: '私人内容',
    createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z', params: DEFAULT_GENERATION_PARAMS,
    paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
    pattern: { width: 1, height: 1, cells: [{ hex: '#FC3D46', code: 'F02', transparent: false }] },
  } });
});
it('创建、提交及撤回重复请求只执行一次，幂等响应不保存快照或私人正文', async () => {
  const first = await create(request(input())); expect(first.status).toBe(201);
  const created = await first.json();
  expect(await (await create(request(input()))).json()).toEqual(created);
  expect(await db.select().from(communityWorks)).toHaveLength(1);
  expect((await create(request({ ...input(), title: '另一作品' }))).status).toBe(409);
  const pending = await (await submit(request({ expectedVersion: 1 }), params(created.revisionId))).json();
  expect(await (await submit(request({ expectedVersion: 1 }), params(created.revisionId))).json()).toEqual(pending);
  const withdrawn = await (await withdrawRevision(request({ expectedVersion: pending.version }), params(created.revisionId))).json();
  expect(await (await withdrawRevision(request({ expectedVersion: pending.version }), params(created.revisionId))).json()).toEqual(withdrawn);
  const revision = await (await revise(request(input()), params(created.workId))).json();
  expect(await (await revise(request(input()), params(created.workId))).json()).toEqual(revision);
  expect(await db.select().from(communityRevisions)).toHaveLength(2);
  const hidden = await (await withdrawWork(request({ expectedVersion: 1 }), params(created.workId))).json();
  expect(await (await withdrawWork(request({ expectedVersion: 1 }), params(created.workId))).json()).toEqual(hidden);
  const responses = JSON.stringify((await db.select().from(idempotencyRecords)).map((item) => item.response));
  for (const secret of [userId, designId, 'private@example.test', '私人内容', '#FC3D46', 'snapshot']) expect(responses).not.toContain(secret);
});
it('版本过期、非本人设计和缺少许可都不创建作品', async () => {
  await db.update(designs).set({ revision: 2 }).where(eq(designs.id, designId));
  expect((await create(request(input()))).status).toBe(409);
  expect((await create(request({ ...input(), expectedDesignRevision: 2, licenseVersion: '' }))).status).toBe(400);
  const [other] = await db.insert(users).values({ email: 'other@example.test', emailVerifiedAt: new Date() }).returning();
  token = (await createSession(db, other.id)).token;
  expect((await create(request({ ...input(), expectedDesignRevision: 2 }))).status).toBe(404);
  expect(await db.select().from(communityWorks)).toHaveLength(0);
});
it('首次投稿和新修订都必须明确确认所见的云端设计版本', async () => {
  const { expectedDesignRevision: _expected, ...withoutVersion } = input();
  expect((await create(request(withoutVersion))).status).toBe(400);
  const created = await (await create(request(input()))).json();
  expect((await revise(request(withoutVersion), params(created.workId))).status).toBe(400);
  expect(await db.select().from(communityRevisions)).toHaveLength(1);
});
it('幂等重放仍检查账号权限，不能让注销、暂停或未验证账号执行投稿', async () => {
  expect((await create(request(input()))).status).toBe(201);
  await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
  expect((await create(request(input()))).status).toBe(403);
  await db.update(users).set({ accountStatus: 'suspended' }).where(eq(users.id, userId));
  expect((await create(request(input()))).status).toBe(401);
});
