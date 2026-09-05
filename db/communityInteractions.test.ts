import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from './testClient';
import {
  adminAuditLogs,
  communityComments,
  communityLikes,
  communityReports,
  communityReuses,
  communityWorks,
  designs,
  idempotencyRecords,
  users,
} from './schema';
import type { Actor } from '@/lib/auth/authorization';
import { DEFAULT_GENERATION_PARAMS, type ProjectFile } from '@/lib/types';
import { COMMUNITY_LICENSE_VERSION } from '@/lib/community/snapshot';
import { createCommunityRevision, createCommunityWork, reviewCommunityRevision, submitCommunityRevision } from '@/lib/community/service';
import {
  createCommunityComment,
  createModerationRuleSet,
  deleteCommunityComment,
  editCommunityComment,
  handleCommunityReport,
  listCommunityComments,
  moderateCommunityComment,
  reportCommunityTarget,
  reuseCommunityWork,
  setCommunityLike,
} from '@/lib/community/interactions';
import { executeIdempotently } from '@/lib/idempotency';
import { anonymizeAccount } from '@/lib/auth/accountLifecycle';
import { LIMITS } from '@/lib/appInfo';

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
  let designId: string;

  beforeEach(async () => {
    db = await createTestClient();
    const [author, reviewer] = await db.insert(users).values([
      { email: 'user@example.com', username: 'User', passwordHash: 'hash', emailVerifiedAt: new Date() },
      { email: 'mod@example.com', username: 'Mod', passwordHash: 'hash', emailVerifiedAt: new Date(), role: 'moderator' },
    ]).returning();
    user = { userId: author.id, role: 'user', accountStatus: 'active', emailVerified: true };
    moderator = { userId: reviewer.id, role: 'moderator', accountStatus: 'active', emailVerified: true };
    designId = crypto.randomUUID();
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
    expect((copy.project as ProjectFile).communityOrigin).toBe(true);
  });

  it.each(['active', 'rows', 'bytes'] as const)('rejects reuse at the %s quota without partial facts or a cached success', async (quota) => {
    if (quota === 'bytes') {
      await db.update(designs).set({ payloadBytes: LIMITS.designBytesPerUser }).where(eq(designs.id, designId));
    } else {
      const limit = quota === 'active' ? LIMITS.designsPerUser : LIMITS.designRowsPerUser;
      await db.insert(designs).values(Array.from({ length: limit - 1 }, () => ({
        id: crypto.randomUUID(), userId: user.userId, name: '配额占用', project: quota === 'rows' ? null : project(), payloadBytes: 0,
        deletedAt: quota === 'rows' ? new Date() : null,
      })));
    }
    const before = await db.select({ id: designs.id }).from(designs);
    const reuse = () => executeIdempotently(db, {
      actorUserId: user.userId, scope: `reuse:${workId}`, key: 'quota-reuse', request: { workId },
    }, (tx) => reuseCommunityWork(tx, { actor: user, workId }));
    await expect(reuse()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.select({ id: designs.id }).from(designs)).toHaveLength(before.length);
    expect(await db.select().from(communityReuses)).toHaveLength(0);
    expect(await db.select().from(idempotencyRecords)).toHaveLength(0);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].reuseCount).toBe(0);
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

  it('starts the edit window when a pending comment is actually published', async () => {
    const pending = await createCommunityComment(db, {
      actor: user, workId, body: '请去死', now: new Date('2026-09-05T01:00:00Z'),
    });
    expect(pending.status).toBe('pending_review');
    await expect(editCommunityComment(db, {
      actor: user, commentId: pending.id, expectedVersion: pending.version,
      body: '审核前不可编辑', now: new Date('2026-09-05T01:05:00Z'),
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const published = await moderateCommunityComment(db, {
      actor: moderator, commentId: pending.id, expectedVersion: pending.version,
      decision: 'published', reason: '结合语境确认允许公开', requestId: 'publish-delayed',
      now: new Date('2026-09-05T03:00:00Z'),
    });
    const firstEdit = await editCommunityComment(db, {
      actor: user, commentId: pending.id, expectedVersion: published.version,
      body: '发布后仍可编辑', now: new Date('2026-09-05T03:01:00Z'),
    });
    const secondEdit = await editCommunityComment(db, {
      actor: user, commentId: pending.id, expectedVersion: firstEdit.version,
      body: '发布后继续安全编辑', now: new Date('2026-09-05T03:02:00Z'),
    });
    expect(secondEdit.status).toBe('published');
    await expect(editCommunityComment(db, {
      actor: user, commentId: pending.id, expectedVersion: secondEdit.version,
      body: '窗口结束拒绝编辑', now: new Date('2026-09-05T03:15:00.001Z'),
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an empty moderation rule-set version', async () => {
    await expect(createModerationRuleSet(db, {
      actor: { ...moderator, role: 'admin' }, rules: [], reason: '不允许关闭全部治理词表', requestId: 'empty-rules',
    })).rejects.toBeDefined();
  });

  it('lets authors delete expired, pending and hidden comments without exposing private comments to others', async () => {
    const expired = await createCommunityComment(db, { actor: user, workId, body: '过了编辑时间仍可删除', now: new Date('2026-01-01T00:00:00Z') });
    const pending = await createCommunityComment(db, { actor: user, workId, body: '请去死' });
    const foreign = await createCommunityComment(db, { actor: moderator, workId, body: '他人的正常评论' });
    const foreignPending = await createCommunityComment(db, { actor: moderator, workId, body: '请去死' });
    const own = await listCommunityComments(db, workId, user.userId);
    expect(own.find((item) => item.id === expired.id)).toMatchObject({ editable: false, deletable: true });
    expect(own.find((item) => item.id === pending.id)).toMatchObject({ status: 'pending_review', editable: false, deletable: true });
    expect(own.find((item) => item.id === foreign.id)).toMatchObject({ editable: false, deletable: false });
    expect(own.some((item) => item.id === foreignPending.id)).toBe(false);
    expect((await listCommunityComments(db, workId)).some((item) => item.id === pending.id)).toBe(false);
    const hidden = await moderateCommunityComment(db, { actor: moderator, commentId: pending.id,
      expectedVersion: pending.version, decision: 'hidden', reason: '隐藏明确伤害评论', requestId: 'hide-own-pending' });
    expect((await listCommunityComments(db, workId, user.userId)).find((item) => item.id === hidden.id)).toMatchObject({ status: 'hidden', deletable: true });
    await deleteCommunityComment(db, { actor: user, commentId: expired.id, expectedVersion: expired.version });
    await deleteCommunityComment(db, { actor: user, commentId: hidden.id, expectedVersion: hidden.version });
    expect((await listCommunityComments(db, workId, user.userId)).map((item) => item.id)).toEqual([foreign.id]);
  });

  it('applies repeat-spam review rules again when a published comment is edited', async () => {
    const earlier = await createCommunityComment(db, {
      actor: user, workId, body: '重复推广内容', now: new Date('2026-09-05T01:00:00Z'),
    });
    const editable = await createCommunityComment(db, {
      actor: user, workId, body: '起初是安全内容', now: new Date('2026-09-05T01:01:00Z'),
    });
    expect(earlier.status).toBe('published');
    expect(editable.status).toBe('published');
    const edited = await editCommunityComment(db, {
      actor: user, commentId: editable.id, expectedVersion: editable.version,
      body: '重复推广内容', now: new Date('2026-09-05T01:02:00Z'),
    });
    expect(edited).toMatchObject({ status: 'pending_review', riskCategories: ['spam'] });
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(1);
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

  it('allows a new report after the work publishes a new immutable revision', async () => {
    await reportCommunityTarget(db, { actor: user, targetType: 'work', targetId: workId, category: 'other' });
    const draft = await createCommunityRevision(db, {
      actor: user, workId, designId, title: '公开作品第二版', licenseVersion: COMMUNITY_LICENSE_VERSION,
    });
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: draft.id, expectedVersion: draft.version });
    await reviewCommunityRevision(db, {
      actor: moderator, revisionId: pending.id, expectedVersion: pending.version,
      decision: 'published', reason: '第二版审核内容完整安全', requestId: 'publish-v2',
    });
    const second = await reportCommunityTarget(db, {
      actor: user, targetType: 'work', targetId: workId, category: 'spam',
    });
    expect(second.targetVersion).toBe(2);
    expect((await db.select().from(communityReports)).map((report) => report.targetVersion).sort()).toEqual([1, 2]);
  });

  it('anonymizes the account without deleting public works or governance facts', async () => {
    await setCommunityLike(db, { actor: user, workId, liked: true });
    await createCommunityComment(db, { actor: user, workId, body: '注销前评论' });
    await reportCommunityTarget(db, { actor: user, targetType: 'work', targetId: workId, category: 'other' });
    await executeIdempotently(db, {
      actorUserId: user.userId, scope: `reuse:${workId}`, key: 'erase-reuse', request: { workId },
    }, (tx) => reuseCommunityWork(tx, { actor: user, workId }));
    await db.insert(adminAuditLogs).values({
      actorUserId: user.userId, actorRole: 'user', action: 'account.private_fact',
      targetType: 'user', targetId: user.userId, reason: '注销前去身份化样本', requestId: 'pre-erase',
      beforeState: { accountStatus: 'active', publicAuthorId: 'must-not-remain' },
    });
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
    expect(await db.select().from(idempotencyRecords)).toHaveLength(0);
    const audits = await db.select().from(adminAuditLogs);
    expect(audits.filter((audit) => audit.targetType === 'user')).toEqual([
      expect.objectContaining({ actorUserId: null, targetId: 'anonymized', beforeState: null, afterState: null }),
      expect.objectContaining({ actorUserId: null, targetId: 'anonymized' }),
    ]);
    expect(JSON.stringify(audits)).not.toContain(user.userId);
    expect(JSON.stringify(audits)).not.toContain('must-not-remain');
  });
});
