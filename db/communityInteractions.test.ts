import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, type TestDatabase } from './testClient';
import {
  adminAuditLogs,
  commentModerationChecks,
  communityComments,
  communityLikes,
  communityReports,
  communityRevisions,
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
  deleteCommunityComment,
  handleCommunityReport,
  listCommunityComments,
  moderateCommunityComment,
  reportCommunityTarget,
  reuseCommunityWork,
  setCommentModerationDeps,
  setCommunityLike,
  getCommunityLike,
} from '@/lib/community/interactions';
import type { TmsVerdict } from '@/lib/moderation/tencentTms';
import { summarizeModerationToday } from '@/lib/moderation/commentModeration';
import { vi } from 'vitest';

/** 确定性的假内容安全服务：含「去死」「伤害词」→ 建议复核；含「拦截词」→ 拦截；其余放行。 */
const fakeModerate = vi.fn(async (_creds: unknown, request: { content: string }): Promise<TmsVerdict> => {
  const suggestion = request.content.includes('拦截词') ? 'Block' : /去死|伤害词/u.test(request.content) ? 'Review' : 'Pass';
  return { suggestion, label: suggestion === 'Pass' ? 'Normal' : suggestion === 'Block' ? 'Ad' : 'Abuse', subLabel: null, score: suggestion === 'Pass' ? 0 : 90, keywords: [], requestId: `fake-${fakeModerate.mock.calls.length}`, latencyMs: 1 };
});
import { executeIdempotently } from '@/lib/idempotency';
import { anonymizeAccount } from '@/lib/auth/accountLifecycle';
import { attachTestOriginal } from './testOriginals';
import { LIMITS } from '@/lib/appInfo';
import { listCommunityReviewQueue } from '@/lib/community/queries';

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

  it('rejects stale actors after account erasure without recreating private data or idempotency facts', async () => {
    await anonymizeAccount(db, { userId: user.userId, requestId: 'erase' });
    await expect(reuseCommunityWork(db, { actor: user, workId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setCommunityLike(db, { actor: user, workId, liked: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(executeIdempotently(db, { actorUserId: user.userId, scope: 'community.reuse', key: 'stale', request: {} },
      (tx) => reuseCommunityWork(tx, { actor: user, workId }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.select().from(designs).where(eq(designs.userId, user.userId))).toEqual([]);
    expect(await db.select().from(communityReuses).where(eq(communityReuses.userId, user.userId))).toEqual([]);
    expect(await db.select().from(communityLikes).where(eq(communityLikes.userId, user.userId))).toEqual([]);
    expect(await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.actorUserId, user.userId))).toEqual([]);
  });

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
    const created = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: '公开作品', licenseVersion: COMMUNITY_LICENSE_VERSION });
    await attachTestOriginal(db, user, created.revision.id);
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: created.revision.id, expectedVersion: 1 });
    await reviewCommunityRevision(db, { actor: moderator, revisionId: pending.id, expectedVersion: pending.version,
      decision: 'published', reason: '审核内容完整安全', requestId: 'publish' });
    workId = created.work.id;
    fakeModerate.mockClear();
    setCommentModerationDeps({ credentials: { secretId: 'test', secretKey: 'test', region: 'ap-guangzhou' }, moderate: fakeModerate });
  });

  it('keeps like counters exact and creates one independent idempotent reuse', async () => {
    expect(await getCommunityLike(db, { workId, userId: user.userId })).toEqual({ liked: false, likeCount: 0 });
    expect(await setCommunityLike(db, { actor: user, workId, liked: true })).toMatchObject({ liked: true, likeCount: 1 });
    expect(await getCommunityLike(db, { workId, userId: user.userId })).toEqual({ liked: true, likeCount: 1 });
    expect(await getCommunityLike(db, { workId, userId: moderator.userId })).toEqual({ liked: false, likeCount: 1 });
    expect(await getCommunityLike(db, { workId })).toEqual({ liked: false, likeCount: 1 });
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

  it('keeps the published count consistent through moderator publication and author deletion', async () => {
    const risky = await createCommunityComment(db, { actor: user, workId, body: '请去死', now: new Date('2026-09-05T01:10:00Z') });
    expect(risky.status).toBe('pending_review');
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(0);
    const published = await moderateCommunityComment(db, { actor: moderator, commentId: risky.id, expectedVersion: risky.version,
      decision: 'published', reason: '语境复核后允许公开', requestId: 'comment-review' });
    expect(published.status).toBe('published');
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(1);
    await expect(moderateCommunityComment(db, { actor: moderator, commentId: published.id, expectedVersion: published.version, decision: 'published', reason: '重复发布应拒绝', requestId: 'duplicate-comment-review' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const deleted = await deleteCommunityComment(db, { actor: user, commentId: risky.id, expectedVersion: published.version });
    expect(deleted).toMatchObject({ status: 'deleted', body: '' });
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(0);
  });

  it('records every content-safety decision, keeps blocked comments for moderators only, and reuses cached verdicts', async () => {
    const now = new Date('2026-09-05T02:00:00Z');
    await expect(createCommunityComment(db, { actor: user, workId, body: '这里有拦截词', now })).rejects.toMatchObject({ code: 'COMMENT_BLOCKED' });
    const [blocked] = await db.select().from(communityComments).where(eq(communityComments.status, 'rejected'));
    expect(blocked).toMatchObject({ body: '这里有拦截词', riskCategories: ['spam'], reviewReason: 'content-safety:tms_block' });
    expect((await listCommunityComments(db, workId, user.userId)).some((item) => item.id === blocked.id)).toBe(false);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].commentCount).toBe(0);
    const checks = await db.select().from(commentModerationChecks);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ commentId: blocked.id, userId: user.userId, workId, provider: 'tencent-tms', suggestion: 'Block', label: 'Ad', outcome: 'rejected', reason: 'tms_block', textLength: '这里有拦截词'.length });
    expect(checks[0].tmsRequestId).toMatch(/^fake-/u);
    expect(JSON.stringify(checks)).not.toContain('这里有拦截词');

    // 同文命中缓存：不再调用服务，判定一致
    const calls = fakeModerate.mock.calls.length;
    const [other] = await db.insert(users).values({ email: 'other@example.com', username: 'Other', passwordHash: 'hash', emailVerifiedAt: new Date() }).returning();
    const otherActor: Actor = { userId: other.id, role: 'user', accountStatus: 'active', emailVerified: true };
    await expect(createCommunityComment(db, { actor: otherActor, workId, body: ' 这里有拦截词 ', now: new Date('2026-09-05T02:01:00Z') })).rejects.toMatchObject({ code: 'COMMENT_BLOCKED' });
    expect(fakeModerate.mock.calls.length).toBe(calls);
    expect((await db.select().from(commentModerationChecks)).map((row) => row.provider).sort()).toEqual(['cached', 'tencent-tms']);

    // 复核建议进待审并标记来源；本地结构特征不调用服务
    const review = await createCommunityComment(db, { actor: user, workId, body: '请去死', now: new Date('2026-09-05T02:02:00Z') });
    expect(review).toMatchObject({ status: 'pending_review', riskCategories: ['harassment'] });
    const links = await createCommunityComment(db, { actor: user, workId, body: '看 https://a.example 和 https://b.example', now: new Date('2026-09-05T02:03:00Z') });
    expect(links).toMatchObject({ status: 'pending_review', riskCategories: ['spam'] });
    const summary = await summarizeModerationToday(db, new Date('2026-09-05T02:04:00Z'));
    expect(summary).toMatchObject({ calls: 2, cached: 1, local: 1, rejected: 2, pendingReview: 2, enabled: expect.any(Boolean) });
  });

  it('falls back to human review when the content-safety service is unavailable or over budget', async () => {
    setCommentModerationDeps({ credentials: null });
    const disabled = await createCommunityComment(db, { actor: user, workId, body: '服务未配置时的评论', now: new Date('2026-09-05T02:10:00Z') });
    expect(disabled.status).toBe('pending_review');
    setCommentModerationDeps({ credentials: { secretId: 't', secretKey: 't', region: 'r' }, moderate: async () => { throw new Error('boom'); } });
    const failed = await createCommunityComment(db, { actor: user, workId, body: '服务失败时的评论', now: new Date('2026-09-05T02:11:00Z') });
    expect(failed.status).toBe('pending_review');
    const checks = await db.select().from(commentModerationChecks);
    expect(checks.map((row) => row.reason).sort()).toEqual(['provider_disabled', 'provider_error']);
    expect(checks.every((row) => row.provider === 'unavailable')).toBe(true);
  });

  it('rejects comment floods before spending any moderation call', async () => {
    const now = new Date('2026-09-05T02:20:00Z');
    for (let index = 0; index < 20; index += 1) {
      await createCommunityComment(db, { actor: user, workId, body: `第 ${index} 条不同评论 ${'。'.repeat(index % 3)}`, now: new Date(now.getTime() + index * 61_000) });
    }
    await expect(createCommunityComment(db, { actor: user, workId, body: '第二十一条评论', now: new Date(now.getTime() + 21 * 61_000) })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const limited = (await db.select().from(commentModerationChecks)).filter((row) => row.reason === 'rate_limited');
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ provider: 'local', outcome: 'rate_limited', commentId: null });
  });

  it('lets authors delete expired, pending and hidden comments without exposing private comments to others', async () => {
    const expired = await createCommunityComment(db, { actor: user, workId, body: '很久以前的评论仍可删除', now: new Date('2026-01-01T00:00:00Z') });
    const pending = await createCommunityComment(db, { actor: user, workId, body: '请去死' });
    const foreign = await createCommunityComment(db, { actor: moderator, workId, body: '他人的正常评论' });
    const foreignPending = await createCommunityComment(db, { actor: moderator, workId, body: '请去死' });
    const own = await listCommunityComments(db, workId, user.userId);
    expect(own.find((item) => item.id === expired.id)).toMatchObject({ deletable: true });
    expect(own.find((item) => item.id === pending.id)).toMatchObject({ status: 'pending_review', deletable: true });
    expect(own.find((item) => item.id === foreign.id)).toMatchObject({ deletable: false });
    expect(own.every((item) => !('editable' in item))).toBe(true);
    expect(own.some((item) => item.id === foreignPending.id)).toBe(false);
    expect((await listCommunityComments(db, workId)).some((item) => item.id === pending.id)).toBe(false);
    const hidden = await moderateCommunityComment(db, { actor: moderator, commentId: pending.id,
      expectedVersion: pending.version, decision: 'hidden', reason: '隐藏明确伤害评论', requestId: 'hide-own-pending' });
    expect((await listCommunityComments(db, workId, user.userId)).find((item) => item.id === hidden.id)).toMatchObject({ status: 'hidden', deletable: true });
    await deleteCommunityComment(db, { actor: user, commentId: expired.id, expectedVersion: expired.version });
    await deleteCommunityComment(db, { actor: user, commentId: hidden.id, expectedVersion: hidden.version });
    expect((await listCommunityComments(db, workId, user.userId)).map((item) => item.id)).toEqual([foreign.id]);
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
      actor: user, workId, designId, expectedDesignRevision: 1, title: '公开作品第二版', licenseVersion: COMMUNITY_LICENSE_VERSION,
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
    const newWork = await createCommunityWork(db, { actor: user, designId, expectedDesignRevision: 1, title: '尚未公开的作品', licenseVersion: COMMUNITY_LICENSE_VERSION });
    const revision = await createCommunityRevision(db, { actor: user, workId, designId, expectedDesignRevision: 1, title: '已有作品的待审修改', licenseVersion: COMMUNITY_LICENSE_VERSION });
    const pending = await submitCommunityRevision(db, { actor: user, revisionId: revision.id, expectedVersion: revision.version });
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
    await db.update(communityWorks).set({ featuredByUserId: user.userId }).where(eq(communityWorks.id, workId));
    await db.update(communityRevisions).set({ reviewedByUserId: user.userId }).where(eq(communityRevisions.workId, workId));
    await db.update(communityComments).set({ reviewedByUserId: user.userId }).where(eq(communityComments.workId, workId));
    await db.update(communityReports).set({ handledByUserId: user.userId }).where(eq(communityReports.reporterUserId, user.userId));
    await db.insert(idempotencyRecords).values([
      { actorUserId: moderator.userId, scope: `admin.user:${user.userId}`, key: 'other-operator-governance', requestHash: 'hash', response: { userId: user.userId }, expiresAt: new Date(Date.now() + 60_000) },
      { actorUserId: moderator.userId, scope: 'admin.comment', key: 'other-operator-response', requestHash: 'hash', response: { comment: { authorUserId: user.userId } }, expiresAt: new Date(Date.now() + 60_000) },
      { actorUserId: moderator.userId, scope: 'admin.revision', key: 'other-operator-public-identity', requestHash: 'hash', response: { publicAuthorId: (await db.select().from(users).where(eq(users.id, user.userId)))[0].publicAuthorId, sourceDesignId: designId }, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    await anonymizeAccount(db, { userId: user.userId, requestId: 'erase-account' });
    expect((await db.select().from(users).where(eq(users.id, user.userId)))[0]).toMatchObject({
      email: null, passwordHash: null, accountStatus: 'anonymized', role: 'user',
    });
    expect(await db.select().from(designs).where(eq(designs.userId, user.userId))).toHaveLength(0);
    expect(await db.select().from(communityLikes).where(eq(communityLikes.userId, user.userId))).toHaveLength(0);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0]).toMatchObject({ likeCount: 0, commentCount: 0, reuseCount: 1 });
    expect((await db.select().from(communityComments))[0]).toMatchObject({ authorUserId: null, status: 'deleted', body: '' });
    expect((await db.select().from(communityReports))[0].reporterUserId).toBeNull();
    expect((await db.select().from(communityReports))[0].handledByUserId).toBeNull();
    expect((await db.select().from(communityComments))[0].reviewedByUserId).toBeNull();
    expect((await db.select().from(communityRevisions))[0].reviewedByUserId).toBeNull();
    expect((await db.select().from(communityWorks))[0].featuredByUserId).toBeNull();
    expect((await db.select().from(communityReuses))[0]).toMatchObject({ userId: null, designId: null });
    expect(await db.select().from(idempotencyRecords)).toHaveLength(0);
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, newWork.work.id)))[0].lifecycleStatus).toBe('withdrawn');
    expect((await db.select().from(communityWorks).where(eq(communityWorks.id, workId)))[0].lifecycleStatus).toBe('active');
    expect((await db.select().from(communityRevisions).where(eq(communityRevisions.id, pending.id)))[0].status).toBe('withdrawn');
    expect(await listCommunityReviewQueue(db)).toEqual([]);
    await expect(reviewCommunityRevision(db, { actor: moderator, revisionId: pending.id, expectedVersion: pending.version, decision: 'published', reason: '账号已注销不可再发布', requestId: 'late-review' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const audits = await db.select().from(adminAuditLogs);
    expect(audits.filter((audit) => audit.targetType === 'user')).toEqual([
      expect.objectContaining({ actorUserId: null, targetId: 'anonymized', beforeState: null, afterState: null }),
      expect.objectContaining({ actorUserId: null, targetId: 'anonymized' }),
    ]);
    expect(JSON.stringify(audits)).not.toContain(user.userId);
    expect(JSON.stringify(audits)).not.toContain('must-not-remain');
  });
});
