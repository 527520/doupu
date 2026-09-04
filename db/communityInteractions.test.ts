import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from './testClient';
import {
  communityComments,
  communityLikes,
  communityReports,
  communityReuses,
  communityWorks,
  designs,
  users,
} from './schema';
import type { Actor } from '@/lib/auth/authorization';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import { createCommunityWork, reviewCommunityRevision, submitCommunityRevision } from '@/lib/community/service';
import {
  createCommunityComment,
  createModerationRuleSet,
  deleteCommunityComment,
  editCommunityComment,
  handleCommunityReport,
  moderateCommunityComment,
  reportCommunityTarget,
  reuseCommunityWork,
  setCommunityLike,
} from '@/lib/community/interactions';
import { executeIdempotently } from '@/lib/idempotency';
import { anonymizeAccount } from '@/lib/auth/accountLifecycle';

function project(): ProjectFile {
  return {
    format: 'doupu-project', version: 3, engineVersion: 'test', boardProfile: '5mm-29', name: 'private',
    createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    paletteSelection: { palette: { kind: 'custom', colors: [{ hex: '#FF0000', code: 'C1' }] }, kitTier: 0 },
    params: { ...DEFAULT_GENERATION_PARAMS, targetWidth: 20, targetColorCount: 2 },
    pattern: { width: 1, height: 1, cells: [{ hex: '#FF0000', code: 'C1', transparent: false }] },
  };
}

describe('community reuse, interaction and governance transactions', () => {
  let db: TestDatabase;
  let user: Actor;
  let moderator: Actor;
  let workId: string;

  beforeEach(async () => {
    db = await createTestClient();
    const [author, reviewer] = await db.insert(users).values([
      { email: 'user@example.com', username: 'User', passwordHash: 'hash', emailVerifiedAt: new Date() },
      { email: 'mod@example.com', username: 'Mod', passwordHash: 'hash', emailVerifiedAt: new Date(), role: 'moderator' },
    ]).returning();
    user = { userId: author.id, role: 'user', accountStatus: 'active', emailVerified: true };
    moderator = { userId: reviewer.id, role: 'moderator', accountStatus: 'active', emailVerified: true };
    const designId = crypto.randomUUID();
    await db.insert(designs).values({ id: designId, userId: author.id, name: 'private', project: project(), payloadBytes: 1 });
    const created = await createCommunityWork(db, { actor: user, designId, title: '公开作品', licenseVersion: COMMUNITY_LICENSE_VERSION });
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    await reviewCommunityRevision(db, { actor: moderator, revisionId: pending.id, expectedVersion: pending.version,
      decision: 'published', reason: '审核内容完整安全', requestId: 'publish' });
    workId = created.work.id;
  });

  it('keeps like counters exact and creates one independent idempotent reuse', async () => {
    expect(await setCommunityLike(db, { actor: user, workId, liked: true })).toMatchObject({ liked: true, likeCount: 1 });
    expect(await setCommunityLike(db, { actor: user, workId, liked: true })).toMatchObject({ liked: true, likeCount: 1 });
    expect(await setCommunityLike(db, { actor: user, workId, liked: false })).toMatchObject({ liked: false, likeCount: 0 });
    expect(await db.select().from(communityLikes)).toHaveLength(0);

    const first = await executeIdempotently(db, { actorUserId: user.userId, scope: `reuse:${workId}`, key: 'reuse-1', request: { workId } },
      (tx) => reuseCommunityWork(tx, { actor: user, workId }));
    const replay = await executeIdempotently(db, { actorUserId: user.userId, scope: `reuse:${workId}`, key: 'reuse-1', request: { workId } },
      (tx) => reuseCommunityWork(tx, { actor: user, workId }));
    expect(replay).toEqual({ value: first.value, replayed: true });
    await expect(executeIdempotently(db, { actorUserId: user.userId, scope: `reuse:${workId}`, key: 'reuse-1', request: { workId, changed: true } },
      (tx) => reuseCommunityWork(tx, { actor: user, workId }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await db.select().from(communityReuses)).toHaveLength(1);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].reuseCount).toBe(1);
    const [copy] = await db.select().from(designs).where(eq(designs.id, first.value.designId));
    expect(copy).toMatchObject({ userId: user.userId, communitySourceWorkId: workId });
  });

  it('re-reviews risky edits, enforces edit window and maintains published count', async () => {
    await createModerationRuleSet(db, { actor: { ...moderator, role: 'admin' },
      rules: [{ literal: '伤害词', category: 'harm', risk: 'review' }], reason: '启用伤害治理字面词', requestId: 'rules' });
    const safe = await createCommunityComment(db, { actor: user, workId, body: '普通评论', now: new Date('2026-09-05T01:00:00Z') });
    expect(safe.status).toBe('published');
    const risky = await editCommunityComment(db, { actor: user, commentId: safe.id, expectedVersion: 1,
      body: '含有伤害词', now: new Date('2026-09-05T01:10:00Z') });
    expect(risky.status).toBe('pending_review');
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(0);
    const published = await moderateCommunityComment(db, { actor: moderator, commentId: risky.id, expectedVersion: risky.version,
      decision: 'published', reason: '语境复核后允许公开', requestId: 'comment-review' });
    expect(published.status).toBe('published');
    const deleted = await deleteCommunityComment(db, { actor: user, commentId: safe.id, expectedVersion: published.version });
    expect(deleted).toMatchObject({ status: 'deleted', body: '' });
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(0);
  });

  it('deduplicates reports by current target version and enforces the case state machine', async () => {
    const report = await reportCommunityTarget(db, { actor: user, targetType: 'work', targetId: workId, category: 'other' });
    await expect(reportCommunityTarget(db, { actor: user, targetType: 'work', targetId: workId, category: 'spam' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    const accepted = await handleCommunityReport(db, { actor: moderator, reportId: report.id, decision: 'accepted',
      expectedVersion: report.version, reason: '举报证据充分进入处置', requestId: 'accept' });
    const resolved = await handleCommunityReport(db, { actor: moderator, reportId: report.id, decision: 'resolved',
      expectedVersion: accepted.version, reason: '目标内容已经完成处置', requestId: 'resolve' });
    expect(resolved.status).toBe('resolved');
    expect(await db.select().from(communityReports)).toHaveLength(1);
    expect(await db.select().from(communityComments)).toHaveLength(0);
  });

  it('anonymizes the account without deleting public works or governance facts', async () => {
    await setCommunityLike(db, { actor: user, workId, liked: true });
    await createCommunityComment(db, { actor: user, workId, body: '注销前评论' });
    await reportCommunityTarget(db, { actor: user, targetType: 'work', targetId: workId, category: 'other' });
    await reuseCommunityWork(db, { actor: user, workId });
    await anonymizeAccount(db, { userId: user.userId, requestId: 'erase-account' });
    expect((await db.select().from(users).where(eq(users.id, user.userId)))[0]).toMatchObject({
      email: null, passwordHash: null, accountStatus: 'anonymized', role: 'user',
    });
    expect(await db.select().from(designs).where(eq(designs.userId, user.userId))).toHaveLength(0);
    expect(await db.select().from(communityLikes).where(eq(communityLikes.userId, user.userId))).toHaveLength(0);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0]).toMatchObject({ likeCount: 0, commentCount: 0, reuseCount: 1 });
    expect((await db.select().from(communityComments))[0]).toMatchObject({ authorUserId: null, status: 'deleted', body: '' });
    expect((await db.select().from(communityReports))[0].reporterUserId).toBeNull();
    expect((await db.select().from(communityReuses))[0]).toMatchObject({ userId: null, designId: null });
  });
});
