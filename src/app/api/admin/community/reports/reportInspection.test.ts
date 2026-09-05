import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from '@/../db/testClient';
import { communityComments, communityReports, communityRevisions, communityWorks, users } from '@/../db/schema';
import { setTestDb } from '@/lib/auth/db';
import { createSession } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import { DEFAULT_GENERATION_PARAMS } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION, deriveCommunityPreview } from '@/lib/community/snapshot';
import { GET } from './[id]/route';

let token: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE_NAME && token ? { value: token } : undefined }) }));

describe('report target inspection authorization and context', () => {
  let db: TestDatabase;
  let moderatorId: string;
  let authorId: string;
  let workId: string;
  const pattern = { width: 1, height: 1, cells: [{ hex: '#FAF4C8', code: 'A01', transparent: false }] };
  const snapshot = {
    version: 1, engineVersion: 'test', boardProfile: '5mm-29',
    paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, backgroundPrototype: null }, pattern,
  };
  beforeEach(async () => {
    db = await createTestClient(); setTestDb(db); token = undefined;
    const [moderator, author] = await db.insert(users).values([
      { email: 'reviewer@example.test', role: 'moderator', emailVerifiedAt: new Date() },
      { email: 'private-author@example.test', role: 'user', emailVerifiedAt: new Date() },
    ]).returning();
    moderatorId = moderator.id; authorId = author.id;
    const [work] = await db.insert(communityWorks).values({ authorUserId: authorId }).returning(); workId = work.id;
    const [revision] = await db.insert(communityRevisions).values({
      workId, revisionNumber: 1, status: 'published', title: '被举报原始作品', authorType: 'user', publicAuthorId: crypto.randomUUID(),
      frozenDisplayName: '作者', licenseVersion: COMMUNITY_LICENSE_VERSION, licenseConfirmedAt: new Date(), engineVersion: 'test',
      boardProfile: '5mm-29', paletteKind: 'builtin', paletteId: 'MARD', width: 1, height: 1, colorCount: 1,
      snapshot, preview: deriveCommunityPreview(pattern), publishedAt: new Date(),
    }).returning();
    await db.update(communityWorks).set({ currentPublishedRevisionId: revision.id }).where(eq(communityWorks.id, workId));
  });
  const get = (id: string) => GET(new Request(`http://localhost:3000/api/admin/community/reports/${id}`), { params: Promise.resolve({ id }) });

  it('requires a moderator and can inspect an unpublished work without revealing private account fields', async () => {
    const [report] = await db.insert(communityReports).values({ targetType: 'work', targetId: workId, targetVersion: 1, category: 'other', reporterUserId: authorId }).returning();
    expect((await get(report.id)).status).toBe(401);
    token = (await createSession(db, authorId)).token;
    expect((await get(report.id)).status).toBe(403);
    token = (await createSession(db, moderatorId)).token;
    let response = await get(report.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ targetId: workId, reportedVersion: 1, contentVersion: 1, changed: false, snapshot, publicUrl: `/community/${workId}` });
    const [original] = await db.select().from(communityRevisions).where(eq(communityRevisions.workId, workId));
    const [replacement] = await db.insert(communityRevisions).values({
      ...original, id: crypto.randomUUID(), revisionNumber: 2, title: '更新后的作品',
    }).returning();
    await db.update(communityRevisions).set({ status: 'superseded' }).where(eq(communityRevisions.id, original.id));
    await db.update(communityWorks).set({ currentPublishedRevisionId: replacement.id }).where(eq(communityWorks.id, workId));
    expect(await (await get(report.id)).json()).toMatchObject({
      title: '被举报原始作品', reportedVersion: 1, contentVersion: 1, currentVersion: 2, changed: true, snapshot,
    });
    await db.update(communityWorks).set({ lifecycleStatus: 'removed' }).where(eq(communityWorks.id, workId));
    response = await get(report.id);
    const body = await response.json();
    expect(body).toMatchObject({ title: '被举报原始作品', workStatus: 'removed', publicUrl: null, snapshot });
    expect(JSON.stringify(body)).not.toContain(authorId);
    expect(JSON.stringify(body)).not.toContain('private-author@example.test');
  });

  it('labels changed or deleted comment content instead of presenting it as the reported version', async () => {
    token = (await createSession(db, moderatorId)).token;
    const [comment] = await db.insert(communityComments).values({ workId, authorUserId: authorId, publicAuthorId: crypto.randomUUID(), frozenDisplayName: '作者', status: 'published', body: '被举报的评论' }).returning();
    const [report] = await db.insert(communityReports).values({ targetType: 'comment', targetId: comment.id, targetVersion: 1, category: 'other' }).returning();
    expect(await (await get(report.id)).json()).toMatchObject({ body: '被举报的评论', changed: false, publicUrl: `/community/${workId}#comment-${comment.id}` });
    await db.update(communityComments).set({ body: '后来编辑的评论', version: 2 }).where(eq(communityComments.id, comment.id));
    expect(await (await get(report.id)).json()).toMatchObject({ body: '后来编辑的评论', reportedVersion: 1, contentVersion: 2, changed: true });
    await db.update(communityComments).set({ body: '', status: 'deleted', version: 3 }).where(eq(communityComments.id, comment.id));
    expect(await (await get(report.id)).json()).toMatchObject({ body: null, contentStatus: 'deleted', publicUrl: null, changed: true });
    const [missing] = await db.insert(communityReports).values({ targetType: 'comment', targetId: crypto.randomUUID(), targetVersion: 1, category: 'other' }).returning();
    expect(await (await get(missing.id)).json()).toMatchObject({ contentVersion: null, contentStatus: null, publicUrl: null, body: null });
    expect((await get(crypto.randomUUID())).status).toBe(404);
  });
});
