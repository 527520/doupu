import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { communityRevisions, communityWorks, users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION, deriveCommunityPreview } from '@/lib/community/snapshot';
import { GET } from './route';
import { GET as inspect, PATCH } from './[id]/route';

let token: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));
let db: TestDatabase;
let moderatorId: string;
let authorId: string;
let workId: string;
const pattern = { width: 1, height: 1, cells: [{ hex: '#FAF4C8', code: 'A01', transparent: false }] };
const snapshot = { version: 1, engineVersion: 'test', boardProfile: '5mm-29', paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 }, params: { ...DEFAULT_GENERATION_PARAMS, backgroundPrototype: null }, pattern };
const list = (query = '') => GET(new Request(`http://localhost/api/admin/community/works${query}`));
const params = () => ({ params: Promise.resolve({ id: workId }) });
const detail = () => inspect(new Request(`http://localhost/api/admin/community/works/${workId}`), params());
beforeEach(async () => {
  db = await createTestClient(); setTestDb(db); token = undefined;
  const [moderator, author] = await db.insert(users).values([
    { email: 'moderator@example.test', role: 'moderator', emailVerifiedAt: new Date() },
    { email: 'private-author@example.test', role: 'user', emailVerifiedAt: new Date() },
  ]).returning();
  moderatorId = moderator.id; authorId = author.id;
  const [work] = await db.insert(communityWorks).values({ authorUserId: authorId }).returning(); workId = work.id;
  const [revision] = await db.insert(communityRevisions).values({ workId, revisionNumber: 1, status: 'published', title: '红色小猫', authorType: 'user', publicAuthorId: crypto.randomUUID(), frozenDisplayName: '豆友', licenseVersion: COMMUNITY_LICENSE_VERSION, licenseConfirmedAt: new Date(), engineVersion: 'test', boardProfile: '5mm-29', paletteKind: 'builtin', paletteId: 'MARD', width: 1, height: 1, colorCount: 1, snapshot, preview: deriveCommunityPreview(pattern), publishedAt: new Date() }).returning();
  await db.update(communityWorks).set({ currentPublishedRevisionId: revision.id }).where(eq(communityWorks.id, workId));
});
it('guards list and detail, limits list payloads, and retains approved material through removal and restore', async () => {
  expect((await list()).status).toBe(401); expect((await detail()).status).toBe(401);
  token = (await createSession(db, authorId)).token;
  expect((await list()).status).toBe(403); expect((await detail()).status).toBe(403);
  token = (await createSession(db, moderatorId)).token;
  const response = await list(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json(); expect(body.items).toHaveLength(1); expect(body.items[0].preview).toMatchObject({ version: 1 });
  expect(JSON.stringify(body)).not.toContain('snapshot');
  const material = await (await detail()).json(); expect(material).toMatchObject({ version: 1, isPublic: true, canRestore: true, material: { snapshot } });
  for (const forbidden of [authorId, 'private-author@example.test', 'authorUserId', 'sourceDesignId']) {
    expect(JSON.stringify(body)).not.toContain(forbidden); expect(JSON.stringify(material)).not.toContain(forbidden);
  }
  const update = async (action: string, version: number) => PATCH(new Request(`http://localhost/api/admin/community/works/${workId}`, { method: 'PATCH', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json', 'idempotency-key': action }, body: JSON.stringify({ action, expectedVersion: version, reason: '复核作品完整状态' }) }), params());
  expect((await update('remove', 1)).status).toBe(200);
  expect(await (await detail()).json()).toMatchObject({ lifecycleStatus: 'removed', isPublic: false, canRestore: true, material: { snapshot } });
  expect((await (await list('?status=active')).json()).items).toHaveLength(0);
  expect((await update('restore', 2)).status).toBe(200);
  expect(await (await detail()).json()).toMatchObject({ isPublic: true, version: 3 });
});
it('uses bounded deterministic cursor pages and supports exact IDs without reading full snapshots', async () => {
  token = (await createSession(db, moderatorId)).token;
  await db.insert(communityWorks).values(Array.from({ length: 51 }, () => ({ authorUserId: authorId, createdAt: new Date('2026-01-01T00:00:00Z') })));
  const first = await (await list()).json(); expect(first.items).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
  const second = await (await list(`?cursor=${first.nextCursor}`)).json(); expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(52);
  expect((await (await list(`?q=${workId}`)).json()).items).toHaveLength(1);
  expect((await list('?cursor=invalid')).status).toBe(400);
  expect((await list('?status=invalid')).status).toBe(400);
});
