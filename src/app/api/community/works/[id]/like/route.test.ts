import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { communityWorks, users, designs } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { createCommunityWork, submitCommunityRevision, reviewCommunityRevision } from '@/lib/community/service';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import { setCommunityLike } from '@/lib/community/interactions';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { GET } from './route';

let token: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));
let db: TestDatabase;
let workId: string;
let userId: string;
beforeEach(async () => {
  db = await createTestClient(); setTestDb(db); token = undefined;
  const [user] = await db.insert(users).values({ email: 'private@example.test', role: 'admin', emailVerifiedAt: new Date() }).returning();
  userId = user.id;
  const actor = { userId, role: 'admin' as const, emailVerified: true, accountStatus: 'active' as const };
  const designId = crypto.randomUUID();
  await db.insert(designs).values({ id: designId, userId, name: 'private', payloadBytes: 1, project: {
    format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: 'private',
    createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z', params: DEFAULT_GENERATION_PARAMS,
    paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
    pattern: { width: 1, height: 1, cells: [{ hex: '#FC3D46', code: 'F02', transparent: false }] },
  } });
  const work = await createCommunityWork(db, { actor, designId, expectedDesignRevision: 1, title: '测试公开作品', licenseVersion: COMMUNITY_LICENSE_VERSION });
  const pending = await submitCommunityRevision(db, { actor, revisionId: work.revision.id, expectedVersion: 1 });
  await reviewCommunityRevision(db, { actor, revisionId: pending.id, expectedVersion: pending.version, decision: 'published', reason: '测试正常公开状态', requestId: 'test' });
  workId = work.work.id;
  await setCommunityLike(db, { actor, workId, liked: true });
});
const get = () => GET(new Request('http://localhost/api/community/works/' + workId + '/like'), { params: Promise.resolve({ id: workId }) });

it('点赞状态不共享缓存，响应仅返回当前查看者布尔值和总数', async () => {
  const guest = await get();
  expect(guest.headers.get('cache-control')).toBe('private, no-store');
  expect(guest.headers.get('vary')).toBe('Cookie');
  expect(await guest.json()).toEqual({ liked: false, likeCount: 1 });
  token = (await createSession(db, userId)).token;
  expect(await (await get()).json()).toEqual({ liked: true, likeCount: 1 });
  const [other] = await db.insert(users).values({ email: 'other@example.test', emailVerifiedAt: new Date() }).returning();
  token = (await createSession(db, other.id)).token;
  expect(await (await get()).json()).toEqual({ liked: false, likeCount: 1 });
});

it('下架作品不再通过点赞状态入口公开', async () => {
  await db.update(communityWorks).set({ lifecycleStatus: 'removed' }).where(eq(communityWorks.id, workId));
  expect((await get()).status).toBe(404);
});
